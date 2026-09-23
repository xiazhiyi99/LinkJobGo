'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { WorkspaceHeader } from '../../../components/workspace/WorkspaceHeader';
import { apiRequest } from '../../../lib/api-client';
import ApplicationsCalendar, { type CalendarItem, type CalendarRange } from '../../../features/workspace/applications/ApplicationsCalendar';
import { ApplicationDialog, ApplicationModal } from '../../../features/workspace/applications/ApplicationDialog';
import { AccountsDialog, MailDetail, ProviderIcon, providerName } from '../../../features/workspace/applications/MailPanels';
import { type Application, type ApplicationStatus, type MailAccount, type MailMessage, type MailProvider, dateText, errorText, statusLabels } from '../../../features/workspace/applications/types';

type View = 'table' | 'calendar';
const unwrap = <T,>(payload: unknown): T => { const data = payload as Record<string, unknown>; if (Array.isArray(payload)) return payload as T; for (const key of ['data', 'items', 'applications', 'messages', 'accounts', 'providers']) if (Array.isArray(data?.[key])) return data[key] as T; return (data?.data || data) as T; };
const pageOf = <T,>(payload: unknown): {items:T[];nextCursor?:string|null} => { const data = payload as Record<string, unknown>; const items = Array.isArray(data?.items) ? data.items as T[] : Array.isArray(data?.data) ? data.data as T[] : Array.isArray(payload) ? payload as T[] : []; return {items, nextCursor: typeof data?.nextCursor === 'string' ? data.nextCursor : null}; };

export default function ApplicationsPage() {
  const [view, setView] = useState<View>('table');
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationsCursor, setApplicationsCursor] = useState<string | null>(null);
  const [mail, setMail] = useState<MailMessage[]>([]);
  const [mailCursor, setMailCursor] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [providers, setProviders] = useState<MailProvider[]>([]);
  const [activeAccount, setActiveAccount] = useState('');
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncRange, setSyncRange] = useState('7');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [selectedMail, setSelectedMail] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showMail, setShowMail] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const loadApplications = useCallback(async (cursor?: string | null, append = false) => {
    setAppLoading(true); setError('');
    try { const params = new URLSearchParams({limit: '100'}); if (cursor) params.set('cursor', cursor); const result = pageOf<Application>(await apiRequest(`/applications?${params}`)); setApplications(items => append ? [...items, ...result.items] : result.items); setApplicationsCursor(result.nextCursor || null); }
    catch (error) { setError(errorText(error)); } finally { setAppLoading(false); }
  }, []);
  const loadAccounts = useCallback(async () => { try { const [accountResult, providerResult] = await Promise.all([apiRequest('/mail-accounts'), apiRequest('/mail/providers')]); const accountItems = unwrap<MailAccount[]>(accountResult) || []; setAccounts(accountItems); setProviders(unwrap<MailProvider[]>(providerResult) || []); setActiveAccount(current => current && accountItems.some(item => item.id === current) ? current : accountItems[0]?.id || ''); } catch (error) { setError(errorText(error)); } }, []);
  const loadMail = useCallback(async (cursor?: string | null, append = false) => {
    if (!activeAccount) { setMail([]); setMailCursor(null); return; }
    setMailLoading(true); setError('');
    try { const params = new URLSearchParams({limit: '50', accountId: activeAccount}); if (cursor) params.set('cursor', cursor); const result = pageOf<MailMessage>(await apiRequest(`/mail-messages?${params}`)); setMail(items => append ? [...items, ...result.items] : result.items); setMailCursor(result.nextCursor || null); }
    catch (error) { setError(errorText(error)); } finally { setMailLoading(false); }
  }, [activeAccount]);
  const loadCalendar = useCallback(async (range: CalendarRange) => { setCalendarLoading(true); try { const result = await apiRequest<{items: CalendarItem[]}>(`/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`); setCalendarItems(result.items || []); } catch (error) { setError(errorText(error)); } finally { setCalendarLoading(false); } }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => { void loadApplications(); }, [loadApplications]);
  useEffect(() => { void loadMail(); }, [loadMail]);

  async function syncMail() { if (!activeAccount) {setShowAccounts(true); return;} setSyncing(true); setNotice(''); try { const started = await apiRequest<{data?: {syncRunId?: string}}>(`/mail-accounts/${encodeURIComponent(activeAccount)}/sync`, {method:'POST', body:JSON.stringify({rangeDays: Number(syncRange), idempotencyKey: `ui:${activeAccount}:${syncRange}:${new Date().toISOString().slice(0,10)}`})}); const runId = started.data?.syncRunId; if (runId) { for (let attempt = 0; attempt < 12; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 250)); const status = await apiRequest<{syncRun?: {status?: string}}>(`/sync-runs/${encodeURIComponent(runId)}`); if (['succeeded', 'partial', 'failed'].includes(status.syncRun?.status || '')) break; } } setNotice('同步任务已提交，正在刷新邮件。'); await Promise.all([loadAccounts(), loadMail()]); } catch (error) {setError(errorText(error));} finally {setSyncing(false);} }
  async function updateStatus(application: Application, status: ApplicationStatus) { setError(''); try { const result = await apiRequest<{application: Application}>(`/applications/${encodeURIComponent(application.id)}`, {method:'PATCH',body:JSON.stringify({status, version:application.version})}); setApplications(items => items.map(item => item.id === application.id ? result.application : item)); setSelectedApplication(current => current?.id === application.id ? result.application : current); } catch (error) {setError(errorText(error)); await loadApplications();} }
  const groups = useMemo(() => { const map = new Map<string, Application[]>(); for (const item of applications) map.set(item.company, [...(map.get(item.company) || []), item]); return [...map.entries()].map(([company, records]) => ({company, records: records.sort((a,b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())})); }, [applications]);
  function showApplication(application: Application) { setSelectedMail(''); setSelectedApplication(application); }
  function refreshAfterSave(application: Application) { setApplications(items => { const found = items.some(item => item.id === application.id); return found ? items.map(item => item.id === application.id ? application : item) : [application, ...items]; }); setSelectedApplication(application); }
  const selectedAccount = accounts.find(item => item.id === activeAccount);

  return <div className="workspace-content applications-page"><WorkspaceHeader title="投递航迹"/>
    <div className="appx-toolbar"><div className="appx-view-switch" role="tablist" aria-label="视图切换">{([['table','表格'],['calendar','日历']] as [View,string][]).map(([key,label]) => <button type="button" role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} key={key} onClick={() => setView(key)}>{label}</button>)}</div><div className="appx-toolbar-actions"><button className="appx-primary appx-mail-trigger" onClick={() => setShowMail(true)}>＋邮件自动同步</button><button className="appx-primary" onClick={() => setShowNew(true)}>＋手动添加记录</button></div></div>
    {notice && <p className="appx-success" role="status">{notice}</p>}{error && <p className="appx-error" role="alert">{error}</p>}
    {showMail && <ApplicationModal title="邮件" onClose={() => setShowMail(false)}><section className="appx-layout appx-mail-modal-layout"><div className="appx-panel appx-mail-layout"><aside className="appx-mail-sidebar"><h4>邮箱连接</h4>{accounts.map(account => <button type="button" className={`appx-mailbox${account.id === activeAccount ? ' active' : ''}`} key={account.id} onClick={() => {setActiveAccount(account.id);setSelectedMail('');}}><ProviderIcon provider={account.provider}/><span><strong>{providerName(account.provider)}</strong><small>{account.email}</small></span></button>)}{!accounts.length && <p className="appx-muted">还没有连接邮箱。</p>}<div className="appx-mail-side-actions"><button onClick={() => setShowAccounts(true)}>管理邮箱连接</button><select value={syncRange} onChange={event => setSyncRange(event.target.value)} aria-label="同步邮件时间范围"><option value="1">近 1 天</option><option value="3">近 3 天</option><option value="7">近 1 周</option><option value="14">近 2 周</option><option value="30">近 1 个月</option><option value="90">近 3 个月</option><option value="180">近 6 个月</option></select><button disabled={syncing || !activeAccount} onClick={() => void syncMail()}>{syncing ? '同步中…' : '↻ 同步邮件'}</button></div>{selectedAccount?.lastSyncedAt && <p className="appx-muted">上次同步：{dateText(selectedAccount.lastSyncedAt)}</p>}</aside><div className="appx-mail-content"><div className="appx-mail-tabs"><strong className="appx-muted">{activeAccount ? selectedAccount?.email : '选择邮箱'}</strong><span className="appx-muted">{mailLoading ? '正在加载…' : `${mail.length} 封`}</span></div>{mailLoading && !mail.length ? <div className="appx-empty">正在加载邮件…</div> : !mail.length ? <div className="appx-empty">暂无邮件。连接邮箱并点击同步后，这里会出现收件记录。</div> : mail.map(message => <button type="button" className={`appx-mail-row${selectedMail === message.id ? ' active' : ''}`} key={message.id} onClick={() => {setSelectedApplication(null);setSelectedMail(message.id);}}><span><strong>{message.fromName || message.fromEmail || '未知发件人'}</strong><span>{message.fromEmail || ''}</span></span><span><strong>{message.subject || '无主题'}</strong><span>{message.snippet || '—'}</span></span><small>{dateText(message.receivedAt)}</small><i className={`appx-mail-dot${message.isJobRelated ? ' job' : ''}`} aria-label={message.isJobRelated ? '招聘邮件' : '其他邮件'}/></button>)}{mailCursor && <div className="appx-mail-load"><button onClick={() => void loadMail(mailCursor, true)} disabled={mailLoading}>{mailLoading ? '加载中…' : '加载更多邮件'}</button></div>}</div></div>{selectedMail && <MailDetail id={selectedMail} onClose={() => setSelectedMail('')} onUpdated={() => void loadMail()} onOpenApplication={id => {const app = applications.find(item => item.id === id); if (app) showApplication(app); else void apiRequest<{application: Application}>(`/applications/${encodeURIComponent(id)}`).then(result => showApplication(result.application));}}/>}</section></ApplicationModal>}
    {view === 'table' && <section className="appx-panel"><div className="appx-panel-head"><h3>{applications.length ? `${applications.length} 条投递记录，${groups.length} 家公司` : '投递记录'}</h3><span className="appx-muted">{appLoading ? '正在加载…' : applicationsCursor ? '还有更多记录' : '已加载全部'}</span></div>{!applications.length && !appLoading ? <div className="appx-empty">还没有投递记录。可以手动添加，或先同步招聘邮箱。</div> : <table className="appx-table"><thead><tr><th>公司</th><th>职位</th><th>状态</th><th>投递日期</th><th>更新</th></tr></thead><tbody>{groups.flatMap(group => {const latest = group.records[0]; const rows = [<tr className="latest" key={latest.id} onClick={() => group.records.length > 1 ? setExpanded(state => ({...state, [group.company]: !state[group.company]})) : showApplication(latest)}><td><div className="company"><span><strong>{group.company}</strong>{group.records.length > 1 && <small>{group.records.length} 条相关记录</small>}</span></div></td><td>{latest.title}</td><td><select className="appx-status-select" value={latest.status} onClick={event => event.stopPropagation()} onChange={event => void updateStatus(latest, event.target.value as ApplicationStatus)} aria-label={`${latest.company}状态`}>{Object.entries(statusLabels).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></td><td>{dateText(latest.appliedOn, false)}</td><td>{dateText(latest.updatedAt, true)}</td></tr>]; if (expanded[group.company]) rows.push(...group.records.slice(1).map(item => <tr className="appx-history-row" key={item.id} onClick={() => showApplication(item)}><td>{item.company}</td><td>{item.title}</td><td><span className="appx-status-badge">{statusLabels[item.status]}</span></td><td>{dateText(item.appliedOn, false)}</td><td>{dateText(item.updatedAt, true)}</td></tr>)); return rows;})}</tbody></table>}{applicationsCursor && <div className="appx-mail-load"><button onClick={() => void loadApplications(applicationsCursor, true)} disabled={appLoading}>{appLoading ? '加载中…' : '加载更多投递记录'}</button></div>}</section>}
    {view === 'calendar' && <section className="appx-panel appx-calendar-wrap"><ApplicationsCalendar items={calendarItems} loading={calendarLoading} onRangeChange={loadCalendar} onSelect={item => {const application = applications.find(app => app.id === (item.applicationId || item.id)); if (application) showApplication(application);}}/></section>}
    {showAccounts && <AccountsDialog accounts={accounts} providers={providers} onChange={loadAccounts} onClose={() => setShowAccounts(false)}/>} {showNew && <ApplicationDialog application={null} onClose={() => setShowNew(false)} onSaved={app => {refreshAfterSave(app);setShowNew(false);}} onOpenMail={id => {setShowNew(false);setSelectedMail(id);}}/>} {selectedApplication && <ApplicationDialog application={selectedApplication} onClose={() => setSelectedApplication(null)} onSaved={refreshAfterSave} onOpenMail={id => {setSelectedApplication(null);setSelectedMail(id);}}/>}
  </div>;
}
