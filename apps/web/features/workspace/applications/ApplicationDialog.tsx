'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { type Application, type ApplicationStatus, type Task, dateInput, dateText, errorText, safeUrl, statusLabels } from './types';
import { inputDateValue, localTimeZone } from './date-time';

export function ApplicationModal({ title, children, onClose, className = '', eyebrow, description }: {title: string; children: ReactNode; onClose: () => void; className?: string; eyebrow?: string; description?: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); } return () => { if (dialog?.open && typeof dialog.close === 'function') dialog.close(); }; }, []);
  return <dialog ref={ref} className={`appx-modal ${className}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div>{eyebrow && <p className="appx-record-eyebrow">{eyebrow}</p>}<h2 id={titleId}>{title}</h2>{description && <div className="appx-record-description">{description}</div>}</div><button type="button" className="appx-icon-button" aria-label="关闭" onClick={onClose}>×</button></header>
    {children}
  </dialog>;
}

const basicFields = [
  ['company', '公司', 'text'], ['title', '职位（选填）', 'text'], ['appliedOn', '投递日期（选填）', 'date'],
] as const;
const scheduleFields = [
  ['eventStart', '笔试 / 面试时间', 'datetime-local'],
  ['assessmentUrl', '笔试 / 测评链接', 'url'], ['interviewUrl', '面试链接', 'url'],
] as const;
const extraFields = [
  ['jobUrl', '职位链接', 'url'], ['nextFollowUpAt', '下次跟进', 'datetime-local'],
  ['nextAction', '下一步行动', 'text'], ['nextActionUrl', '行动链接', 'url'],
] as const;
const fields = [...basicFields, ...scheduleFields, ...extraFields];

export function ApplicationDialog({ application, onClose, onSaved, onOpenMail }: {application: Application | null; onClose: () => void; onSaved: (application: Application) => void; onOpenMail: (id: string) => void}) {
  const [current, setCurrent] = useState(application);
  const [loading, setLoading] = useState(Boolean(application));
  const [busy, setBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState('');
  const [error, setError] = useState('');
  const tasks = current?.tasks || [];
  const actionPending = useRef(false);
  const [formKey, setFormKey] = useState(0);
  const [saved, setSaved] = useState(false);
  const formId = useId();
  useEffect(() => {
    if (!application) return;
    let cancelled = false;
    apiRequest<{application: Application}>(`/applications/${encodeURIComponent(application.id)}`).then(result => { if (!cancelled) { setCurrent(result.application); setFormKey(key => key + 1); } }).catch(error => { if (!cancelled) setError(errorText(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [application?.id]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (actionPending.current || loading) return;
    actionPending.current = true; setBusy(true); setError(''); setSaved(false);
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const payload: Record<string, unknown> = { ...data, status: data.status as ApplicationStatus, ...(current ? {version: current.version} : {source: 'manual', idempotencyKey: crypto.randomUUID()}) };
      for (const [key, , type] of fields) if (type === 'date' || type === 'datetime-local') {
        const raw = String(data[key] || '');
        payload[key] = current?.[key] && raw === dateInput(current[key], type === 'datetime-local') ? current[key] : inputDateValue(raw, type === 'datetime-local');
      }
      // A rescheduled start must not retain an invisible end from the old schedule.
      if (String(data.eventStart || '') !== dateInput(current?.eventStart, true)) payload.eventEnd = null;
      const result = await apiRequest<{application: Application}>(current ? `/applications/${encodeURIComponent(current.id)}` : '/applications', {method: current ? 'PATCH' : 'POST', body: JSON.stringify(payload)});
      const updated = {...current, ...result.application}; setCurrent(updated); setSaved(true); onSaved(updated);
    } catch (error) { setError(errorText(error)); } finally { setBusy(false); actionPending.current = false; }
  }
  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!current || actionPending.current) return;
    actionPending.current = true;
    const form = event.currentTarget; const data = new FormData(form); setTaskBusy('new'); setError('');
    try { const result = await apiRequest<{task: Task}>(`/applications/${encodeURIComponent(current.id)}/tasks`, {method: 'POST', body: JSON.stringify({title: data.get('taskTitle'), dueAt: inputDateValue(String(data.get('taskDue') || ''), true), idempotencyKey: crypto.randomUUID()})}); const updated = {...current, tasks: [...tasks, result.task]}; setCurrent(updated); form.reset(); onSaved(updated); } catch (error) { setError(errorText(error)); } finally { setTaskBusy(''); actionPending.current = false; }
  }
  async function toggleTask(task: Task) {
    if (!current || actionPending.current) return;
    actionPending.current = true;
    setTaskBusy(task.id); setError('');
    try { const result = await apiRequest<{task: Task}>(`/tasks/${encodeURIComponent(task.id)}`, {method: 'PATCH', body: JSON.stringify({status: task.status === 'done' ? 'open' : 'done'})}); const updated = {...current, tasks: tasks.map(item => item.id === task.id ? result.task : item)}; setCurrent(updated); onSaved(updated); } catch (error) { setError(errorText(error)); } finally { setTaskBusy(''); actionPending.current = false; }
  }
  const renderField = ([key, label, type]: typeof fields[number]) => <label key={key}>{label}<input name={key} type={type} required={key === 'company'} defaultValue={type === 'date' || type === 'datetime-local' ? dateInput(current?.[key], type === 'datetime-local') : current?.[key] || ''}/></label>;
  const sourceLabel = ({manual: '手动添加', extension: '填写助手', email: '招聘邮件'} as Record<string, string>)[current?.source || ''] || '—';
  return <ApplicationModal
    title={current?.company || '手动添加投递'}
    eyebrow={current ? '投递记录' : undefined}
    description={current ? <><span>{current.title || '职位待补充'}</span><span className="appx-record-status" data-status={current.status}>{statusLabels[current.status]}</span></> : '只需填写公司，其他信息可稍后补充。'}
    className="appx-record-modal"
    onClose={onClose}
  >
    <div className="appx-record-body">
      {error && <p role="alert" className="appx-error">{error}</p>}
      {loading ? <div className="appx-record-loading" role="status"><span>正在读取记录…</span><i/><i/><i/></div> : <>
        <p className="appx-muted">时间均按本机时区显示：{localTimeZone()}</p>
        <form id={formId} key={formKey} className="appx-record-form" onSubmit={save} onChange={() => setSaved(false)}>
          <section className="appx-record-section">
            <div className="appx-record-section-heading"><h3>基本信息</h3><span>仅公司必填</span></div>
            <div className="appx-form">{basicFields.map(renderField)}<label>招聘状态<select name="status" defaultValue={current?.status || 'saved'}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          </section>
          <details className="appx-record-disclosure" open={Boolean(current?.eventStart || current?.assessmentUrl || current?.interviewUrl)}>
            <summary><span>笔试 / 面试安排<small>时间与参会链接</small></span><span className="appx-record-optional">选填</span></summary>
            <div className="appx-form">{scheduleFields.map(renderField)}</div>
          </details>
          <details className="appx-record-disclosure">
            <summary><span>更多信息<small>职位链接、跟进与备注</small></span><span className="appx-record-optional">选填</span></summary>
            <div className="appx-form">{extraFields.map(renderField)}<label className="appx-full">备注<textarea name="notes" rows={3} defaultValue={current?.notes || ''} placeholder="记录沟通要点或准备事项"/></label></div>
          </details>
        </form>
        {current && <section className="appx-record-section appx-record-tasks">
          <div className="appx-record-section-heading"><h3>跟进任务 <span className="appx-record-count">{tasks.filter(task => task.status !== 'done').length}</span></h3><span>记下下一步</span></div>
          {tasks.map(task => <div className="appx-task" key={task.id}><label><input type="checkbox" checked={task.status === 'done'} onChange={() => void toggleTask(task)} disabled={busy || Boolean(taskBusy)}/><span className={task.status === 'done' ? 'appx-done' : ''}>{task.title}</span></label><small>{task.dueAt ? dateText(task.dueAt) : ''}</small>{safeUrl(task.url) && <a href={safeUrl(task.url)} target="_blank" rel="noopener noreferrer">打开 ↗</a>}</div>)}
          {!tasks.length && <p className="appx-record-empty">暂无跟进任务，添加一件接下来要做的事。</p>}
          <form className="appx-task-form" onSubmit={addTask}>
            <label>任务内容<input name="taskTitle" placeholder="如：准备业务面试" required/></label>
            <label>提醒时间 <span>选填</span><input name="taskDue" type="datetime-local"/></label>
            <button type="submit" disabled={busy || Boolean(taskBusy)}>{taskBusy === 'new' ? '添加中…' : '添加任务'}</button>
          </form>
        </section>}
        {current && <details className="appx-record-disclosure appx-record-history">
          <summary><span>来源与历史<small>{sourceLabel}{current.createdAt ? ` · ${dateText(current.createdAt, false)} 添加` : ''}</small></span><span className="appx-record-optional">{(current.mailMessages?.length || 0) + (current.events?.length || 0)} 条</span></summary>
          <div>{current.mailMessages?.map(mail => <button type="button" className="appx-history" key={mail.id} onClick={() => onOpenMail(mail.id)}><span>{mail.subject}</span><small>{dateText(mail.receivedAt)} ↗</small></button>)}{current.events?.map(item => <div className="appx-history" key={item.id}><span>{item.type === 'fill.completed' ? '填写已完成' : item.type === 'application.submitted' ? '已确认投递' : item.type}</span><small>{dateText(item.occurredAt)}</small></div>)}{!current.mailMessages?.length && !current.events?.length && <p className="appx-record-empty">暂无关联邮件或历史记录。</p>}</div>
        </details>}
      </>}
    </div>
    <footer className="appx-record-footer">
      <span className={saved ? 'appx-record-saved' : ''} role="status">{saved ? '更改已保存' : current ? `来源：${sourceLabel}` : '保存后可添加跟进任务'}</span>
      <div><button type="button" className="appx-secondary" onClick={onClose}>关闭</button><button type="submit" form={formId} className="appx-primary" disabled={busy || loading || Boolean(taskBusy)}>{busy ? '保存中…' : current ? '保存更改' : '创建记录'}</button></div>
    </footer>
  </ApplicationModal>;
}
