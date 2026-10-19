'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../../components/auth/AuthGate';
import { apiRequest, ApiRequestError } from '../../lib/api-client';
import { routes } from '../../lib/routes';
import { filterSiteRules, isAdminAccount, routeLabel, hashRouteLabel, type SiteRulesCatalog } from './site-rules';
import styles from './site-rules.module.css';

export function SiteRulesManagement() {
  const admin = isAdminAccount(useAccount());
  const [catalog, setCatalog] = useState<SiteRulesCatalog | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState<'all' | 'registered' | 'off'>('all');
  const sequence = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const mine = ++sequence.current;
    setLoading(true); setError('');
    try {
      const result = await apiRequest<SiteRulesCatalog>('/admin/autofill/sites', { signal, cache: 'no-store' });
      if (signal?.aborted || mine !== sequence.current) return;
      if (result.source !== 'code' || !Array.isArray(result.sites)) throw new Error('规则目录响应无效');
      setCatalog(result);
    } catch (failure) {
      if (signal?.aborted || mine !== sequence.current) return;
      setCatalog(null);
      setError(failure instanceof ApiRequestError && failure.status === 403 ? '当前账号没有管理员权限。' : failure instanceof Error ? failure.message : '暂时无法加载规则目录');
    } finally { if (!signal?.aborted && mine === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController(); void load(controller.signal);
    return () => { controller.abort(); sequence.current++; };
  }, [admin, load]);

  if (!admin) return <section className={styles.notice} role="status"><h2>仅管理员可访问</h2><p>请使用管理员账号查看网站规则。</p><Link href={routes.autofill}>返回智能填写 ↗</Link></section>;
  const sites = catalog?.sites ?? [], visible = filterSiteRules(sites, query, status);
  const registered = sites.filter(site => site.registered).length;
  const domains = new Set(sites.flatMap(site => site.origins)).size;
  return <section className={styles.page}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>管理员 · 代码规则</p><h2>网站规则</h2><p className={styles.description}>一套服务商规则可复用到多个公司页面；公司专属规则优先。目录来自当前后端，实际填写仍会校验控件结构。</p></div><button className={styles.refresh} disabled={loading} onClick={() => void load()}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M16 6V2m0 4h-4M4 14v4m0-4h4"/><path d="M16 6A7 7 0 0 0 4 5m0 9a7 7 0 0 0 12 1"/></svg>{loading ? '加载中…' : '刷新目录'}</button></div>
    <div className={styles.metrics} aria-label="规则统计"><p><strong>{catalog ? sites.length : '—'}</strong><span>套代码规则</span></p><p><strong>{catalog ? registered : '—'}</strong><span>套当前已注册</span></p><p><strong>{catalog ? domains : '—'}</strong><span>个精确域名</span></p></div>
    <div className={styles.toolbar}><label className={styles.search}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input type="search" aria-label="搜索网站规则" placeholder="搜索网站、域名或路径" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="注册状态" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="registered">当前已注册</option><option value="off">当前未注册</option></select><span className={styles.results} role="status">{catalog ? `${visible.length} / ${sites.length} 套规则` : ''}</span></div>
    {error ? <div className={styles.notice} role="alert"><h3>规则目录未加载</h3><p>{error}</p><button onClick={() => void load()}>重新加载</button></div> : loading && !catalog ? <div className={styles.skeleton} aria-label="正在加载规则目录" aria-busy="true">{[0, 1, 2, 3].map(row => <div key={row} />)}</div> : <div className={styles.tableWrap} aria-busy={loading}>
      <table><caption className={styles.srOnly}>当前代码中的网站注册规则</caption><thead><tr><th scope="col">网站 / 服务商</th><th scope="col">适用域名</th><th scope="col">页面路径规则</th><th scope="col">版本</th><th scope="col">注册状态</th></tr></thead><tbody>{visible.map(site => <tr key={site.id}><th scope="row"><strong>{site.name}</strong><small>{site.id}</small><small className={styles.scope}>{site.scope === 'provider' ? '服务商通用' : '网站专属'}{site.provider ? ` · ${site.provider}` : ''}</small></th><td>{site.origins.map(origin => <div key={origin} className={styles.origin}><code>{new URL(origin).host}</code><small>{new URL(origin).protocol.replace(':', '').toUpperCase()} · 精确匹配</small></div>)}</td><td><div className={styles.paths}>{site.routes.map((route, index) => <div key={index}><span>{route.kind === 'regex' ? '正则路径' : '精确路径'}{route.tenant ? ` · ${route.tenant}` : ''}</span><code>{routeLabel(route)}</code>{route.hashRoute && <><span>Hash 路由 · {route.hashRouteKind === 'regex' ? '正则匹配' : '精确匹配'}</span><code>{hashRouteLabel(route)}</code></>}</div>)}</div></td><td><code className={styles.version}>{site.version}</code></td><td><span className={styles.state} data-mode={site.mode}>{site.mode === 'off' ? '未注册' : site.mode === 'candidate' ? '候选运行' : '已注册'}</span></td></tr>)}</tbody></table>
      {!visible.length && <p className={styles.empty}>没有匹配的规则，请调整搜索或筛选条件。</p>}
    </div>}
    <p className={styles.footnote}>同一规则可登记多个精确域名；动态公司、表单和职位按路径 / Hash 模式匹配。公司专属规则优先于服务商通用规则，同层按优先级选择；控件不兼容的未知页面保留原 AI 路径。{catalog && <span>读取于 {new Date(catalog.generatedAt).toLocaleString('zh-CN', { hour12: false })}</span>}</p>
  </section>;
}
