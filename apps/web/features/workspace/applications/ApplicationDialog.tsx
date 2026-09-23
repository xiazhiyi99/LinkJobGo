'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { type Application, type ApplicationStatus, type Task, dateInput, dateText, errorText, safeUrl, statusLabels } from './types';

export function ApplicationModal({ title, children, onClose }: {title: string; children: ReactNode; onClose: () => void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); } return () => { if (dialog?.open && typeof dialog.close === 'function') dialog.close(); }; }, []);
  return <dialog ref={ref} className="appx-modal" onCancel={event => { event.preventDefault(); onClose(); }}><header><h2>{title}</h2><button className="appx-icon-button" aria-label="关闭" onClick={onClose}>×</button></header>{children}</dialog>;
}

const fields = [
  ['company', '公司', 'text'], ['title', '职位', 'text'], ['appliedOn', '投递日期', 'date'], ['jobUrl', '职位链接', 'url'],
  ['eventStart', '笔试 / 面试开始', 'datetime-local'], ['eventEnd', '笔试 / 面试结束', 'datetime-local'],
  ['assessmentUrl', '笔试 / 测评链接', 'url'], ['interviewUrl', '面试链接', 'url'], ['nextFollowUpAt', '下次跟进', 'datetime-local'], ['nextAction', '下一步行动', 'text'], ['nextActionUrl', '行动链接', 'url'],
] as const;

export function ApplicationDialog({ application, onClose, onSaved, onOpenMail }: {application: Application | null; onClose: () => void; onSaved: (application: Application) => void; onOpenMail: (id: string) => void}) {
  const [current, setCurrent] = useState(application);
  const [loading, setLoading] = useState(Boolean(application));
  const [busy, setBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState('');
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState<Task[]>(application?.tasks || []);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (!application) return;
    let cancelled = false;
    apiRequest<{application: Application}>(`/applications/${encodeURIComponent(application.id)}`).then(result => { if (!cancelled) { setCurrent(result.application); setTasks(result.application.tasks || []); setFormKey(key => key + 1); } }).catch(error => { if (!cancelled) setError(errorText(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [application?.id]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload: Record<string, unknown> = { ...data, status: data.status as ApplicationStatus, ...(current ? {version: current.version} : {source: 'manual', idempotencyKey: crypto.randomUUID()}) };
    for (const [key, , type] of fields) if (type === 'date' || type === 'datetime-local') payload[key] = data[key] ? new Date(String(data[key])).toISOString() : null;
    if (payload.eventStart && payload.eventEnd && new Date(String(payload.eventEnd)) <= new Date(String(payload.eventStart))) { setError('结束时间需要晚于开始时间。'); setBusy(false); return; }
    try { const result = await apiRequest<{application: Application}>(current ? `/applications/${encodeURIComponent(current.id)}` : '/applications', {method: current ? 'PATCH' : 'POST', body: JSON.stringify(payload)}); setCurrent({...current, ...result.application}); onSaved(result.application); }
    catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!current) return;
    const form = event.currentTarget; const data = new FormData(form); setTaskBusy('new'); setError('');
    try { const result = await apiRequest<{task: Task}>(`/applications/${encodeURIComponent(current.id)}/tasks`, {method: 'POST', body: JSON.stringify({title: data.get('taskTitle'), dueAt: data.get('taskDue') ? new Date(String(data.get('taskDue'))).toISOString() : null, idempotencyKey: crypto.randomUUID()})}); setTasks(items => [...items, result.task]); form.reset(); onSaved(current); } catch (error) { setError(errorText(error)); } finally { setTaskBusy(''); }
  }
  async function toggleTask(task: Task) {
    setTaskBusy(task.id); setError('');
    try { const result = await apiRequest<{task: Task}>(`/tasks/${encodeURIComponent(task.id)}`, {method: 'PATCH', body: JSON.stringify({status: task.status === 'done' ? 'open' : 'done'})}); setTasks(items => items.map(item => item.id === task.id ? result.task : item)); if (current) onSaved(current); } catch (error) { setError(errorText(error)); } finally { setTaskBusy(''); }
  }
  return <ApplicationModal title={current ? '投递记录' : '手动添加投递'} onClose={onClose}>
    {error && <p role="alert" className="appx-error">{error}</p>}
    {loading ? <div className="appx-empty">正在读取记录…</div> : <>
      <form key={formKey} className="appx-form" onSubmit={save}>
        {fields.map(([key, label, type]) => <label key={key}>{label}<input name={key} type={type} required={key === 'company' || key === 'title'} defaultValue={type === 'date' || type === 'datetime-local' ? dateInput(current?.[key], type === 'datetime-local') : current?.[key] || ''}/></label>)}
        <label>招聘状态<select name="status" defaultValue={current?.status || 'saved'}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="appx-full">备注<textarea name="notes" rows={3} defaultValue={current?.notes || ''}/></label>
        <div className="appx-full appx-actions"><span className="appx-muted">{current ? `来源：${({manual: '手动添加', extension: '填写助手', email: '招聘邮件'} as Record<string,string>)[current.source || ''] || '—'}` : '保存后可继续添加跟进任务'}</span><button className="appx-primary" disabled={busy}>{busy ? '保存中…' : '保存记录'}</button></div>
      </form>
      {current && <section className="appx-dialog-section"><h3>跟进任务</h3>{tasks.map(task => <div className="appx-task" key={task.id}><label><input type="checkbox" checked={task.status === 'done'} onChange={() => void toggleTask(task)} disabled={Boolean(taskBusy)}/><span className={task.status === 'done' ? 'appx-done' : ''}>{task.title}</span></label><small>{dateText(task.dueAt)}</small>{safeUrl(task.url) && <a href={safeUrl(task.url)} target="_blank" rel="noopener noreferrer">打开 ↗</a>}</div>)}{!tasks.length && <p className="appx-muted">还没有任务，记下下一步准备事项。</p>}<form className="appx-task-form" onSubmit={addTask}><input name="taskTitle" aria-label="任务内容" placeholder="如：准备业务面试" required/><input name="taskDue" aria-label="任务截止时间" type="datetime-local"/><button disabled={Boolean(taskBusy)}>{taskBusy === 'new' ? '添加中…' : '添加任务'}</button></form></section>}
      {current && <section className="appx-dialog-section"><h3>来源与历史</h3>{current.mailMessages?.map(mail => <button type="button" className="appx-history" key={mail.id} onClick={() => onOpenMail(mail.id)}><span>{mail.subject}</span><small>{dateText(mail.receivedAt)} ↗</small></button>)}{current.events?.map(item => <div className="appx-history" key={item.id}><span>{item.type === 'fill.completed' ? '填写已完成' : item.type === 'application.submitted' ? '已确认投递' : item.type}</span><small>{dateText(item.occurredAt)}</small></div>)}{!current.mailMessages?.length && !current.events?.length && <p className="appx-muted">暂无关联邮件或事件。</p>}</section>}
    </>}
  </ApplicationModal>;
}
