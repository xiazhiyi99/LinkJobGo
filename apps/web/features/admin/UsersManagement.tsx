'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../../components/auth/AuthGate';
import { apiRequest, ApiRequestError } from '../../lib/api-client';
import { routes } from '../../lib/routes';
import { isAdminAccount } from './site-rules';
import { canChangeUserRole, formatAdminDate, roleLabel, roleChangeExplanation, type AccountRole, type ManagedUser, type UsersPage } from './users';
import base from './site-rules.module.css';
import styles from './users.module.css';

function RoleChangeDialog({ user, onClose, onChanged, onForbidden }: { user: ManagedUser; onClose(): void; onChanged(): void; onForbidden(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState<AccountRole>(user.role === 'admin' ? 'user' : 'admin');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); }; }, []);
  const save = async () => {
    setBusy(true); setError('');
    try {
      await apiRequest(`/admin/users/${encodeURIComponent(user.id)}/role`, { method: 'PATCH', body: JSON.stringify({ role, expectedRole: user.role }) });
      onChanged();
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 403) { onForbidden(); return; }
      setError(failure instanceof Error ? failure.message : '权限修改失败，请重试');
    } finally { setBusy(false); }
  };
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="role-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className={styles.dialogHeading}><div><p>账号权限</p><h2 id="role-dialog-title">调整用户权限</h2></div><button type="button" aria-label="关闭权限弹窗" disabled={busy} onClick={onClose}>×</button></div>
    <p className={styles.target}>{user.name || '未设置姓名'}<span>{user.email}</span></p>
    <label className={styles.roleSelect}>账号角色<select aria-label="新的用户权限" value={role} disabled={busy} onChange={event => setRole(event.target.value as AccountRole)}><option value="user">普通用户</option><option value="admin">管理员</option></select></label>
    <p className={styles.explanation}>{roleChangeExplanation(role)}</p>
    <p className={styles.changeSummary}>{roleLabel(user.role)} <span aria-hidden="true">→</span> {roleLabel(role)}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.dialogActions}><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className={styles.primary} disabled={busy || role === user.role} onClick={() => void save()}>{busy ? '正在保存…' : '确认调整'}</button></div>
  </dialog>;
}

export function UsersManagement() {
  const account = useAccount(), admin = isAdminAccount(account);
  const [data, setData] = useState<UsersPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [draft, setDraft] = useState(''), [query, setQuery] = useState(''), [role, setRole] = useState('all'), [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ManagedUser | null>(null), [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const mine = ++sequence.current; setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ q: query, role, page: String(page), pageSize: '25' });
      const result = await apiRequest<UsersPage>(`/admin/users?${params}`, { signal, cache: 'no-store' });
      if (signal?.aborted || mine !== sequence.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / 25));
      if (page > lastPage) { setPage(lastPage); return; }
      setData(result);
    } catch (failure) {
      if (signal?.aborted || mine !== sequence.current) return;
      setData(null); setError(failure instanceof ApiRequestError && failure.status === 403 ? '当前账号没有管理员权限，请刷新页面。' : failure instanceof Error ? failure.message : '用户列表加载失败');
    } finally { if (!signal?.aborted && mine === sequence.current) setLoading(false); }
  }, [query, role, page]);
  useEffect(() => { if (!admin) return; const controller = new AbortController(); void load(controller.signal); return () => { controller.abort(); sequence.current++; }; }, [admin, load]);

  if (!admin) return <section className={base.notice} role="status"><h2>仅管理员可访问</h2><p>请使用管理员账号管理用户。</p><Link href={routes.autofill}>返回智能填写 ↗</Link></section>;
  const items = data?.items ?? [], pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));
  return <section className={base.page}>
    <div className={base.heading}><div><p className={base.eyebrow}>管理员 · 账号与权限</p><h2>用户管理</h2><p className={base.description}>查看注册信息、投递概况和账号角色。权限调整后，后续管理接口与扩展权限检查会使用新角色。</p></div><button type="button" className={base.refresh} disabled={loading} onClick={() => void load()}>{loading ? '加载中…' : '刷新列表'}</button></div>
    <form className={`${base.toolbar} ${styles.toolbar}`} onSubmit={event => { event.preventDefault(); setPage(1); setQuery(draft.trim()); }}><label className={base.search}><input type="search" aria-label="搜索用户" maxLength={120} placeholder="搜索姓名或邮箱" value={draft} onChange={event => setDraft(event.target.value)} /></label><button type="submit" className={styles.searchButton}>搜索</button><select aria-label="用户权限筛选" value={role} onChange={event => { setRole(event.target.value); setPage(1); }}><option value="all">全部权限</option><option value="user">普通用户</option><option value="admin">管理员</option></select><span className={base.results} role="status">{data ? `共 ${data.total} 位用户` : ''}</span></form>
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {error ? <div className={base.notice} role="alert"><h3>用户列表未加载</h3><p>{error}</p><button type="button" onClick={() => void load()}>重新加载</button></div> : loading && !data ? <div className={base.skeleton} aria-label="正在加载用户列表">{[0, 1, 2].map(row => <div key={row} />)}</div> : <div className={`${base.tableWrap} ${styles.table}`} aria-busy={loading}>
      <table><caption className={base.srOnly}>用户账号和投递概况</caption><thead><tr><th scope="col">用户</th><th scope="col">权限</th><th scope="col">注册时间</th><th scope="col">邮箱状态</th><th scope="col">投递记录 / 网站</th><th scope="col">操作</th></tr></thead><tbody>{items.map(user => <tr key={user.id}>
        <th scope="row"><strong>{user.name || '未设置姓名'}{account?.id === user.id && <span className={styles.self}>当前账号</span>}</strong><span className={styles.email}>{user.email}</span><small>{user.id}</small></th>
        <td><span className={styles.role} data-role={user.role}>{roleLabel(user.role)}</span></td>
        <td><time dateTime={user.createdAt}>{formatAdminDate(user.createdAt)}</time></td>
        <td><span className={styles.verification} data-verified={user.emailVerified}>{user.emailVerified ? '已验证' : '未验证'}</span></td>
        <td><p className={styles.count}><strong>{user.submittedCount}</strong> 次已投递 <span>共 {user.applicationCount} 条航迹</span></p><div className={styles.websites}>{user.websites.slice(0, 3).map(site => <span key={site.host}><code>{site.host}</code><small>{site.count} 次</small></span>)}{user.websites.length > 3 && <details><summary>另 {user.websites.length - 3} 个网站</summary>{user.websites.slice(3).map(site => <span key={site.host}><code>{site.host}</code><small>{site.count} 次</small></span>)}</details>}{!user.websites.length && <em>{user.submittedCount ? '未记录有效网站链接' : '暂无已投递记录'}</em>}</div>{user.missingWebsiteCount > 0 && <small>另 {user.missingWebsiteCount} 条未记录有效网站链接</small>}{user.lastApplicationAt && <small>最近记录更新 {formatAdminDate(user.lastApplicationAt)}</small>}</td>
        <td><button type="button" className={styles.edit} disabled={loading || !canChangeUserRole(account, user)} onClick={() => { setNotice(''); setEditing(user); }}>{account?.id === user.id ? '自身权限不可修改' : '调整权限'}</button></td>
      </tr>)}</tbody></table>{!items.length && <p className={base.empty}>没有匹配的用户，请调整搜索条件。</p>}
    </div>}
    <div className={styles.footer}><p className={base.footnote}>网站来自投递记录中的链接，仅收藏不计为已投递；此处不统计扩展访问或填写过的全部页面。</p><nav aria-label="用户列表分页"><button type="button" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} / {pages} 页</span><button type="button" disabled={loading || !data || page >= pages} onClick={() => setPage(value => value + 1)}>下一页</button></nav></div>
    {editing && <RoleChangeDialog key={editing.id} user={editing} onClose={() => setEditing(null)} onChanged={() => { setEditing(null); setNotice('用户权限已更新。'); void load(); }} onForbidden={() => { setEditing(null); setData(null); setError('当前账号已失去管理员权限，请刷新页面。'); }} />}
  </section>;
}
