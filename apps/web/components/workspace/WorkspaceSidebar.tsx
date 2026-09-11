"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { workspaceNavigation } from "../../features/workspace/navigation";

export function WorkspaceSidebar() {
  const pathname = usePathname();
  return <aside className="workspace-sidebar">
    <Link className="workspace-brand" href="/" aria-label="领客首页">领客<span className="brand-dot">.</span></Link>
    <nav className="workspace-nav" aria-label="功能导航">
      {workspaceNavigation.map((item, index) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={pathname === item.href ? "active" : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{index === 0 ? <><circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M4 3h16"/></> : index === 1 ? <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m8 12 2 2 5-5M8 17h8"/></> : <><path d="M5 4v15h15M5 15l5-5 4 3 6-8"/><path d="M16 5h4v4"/></>}</svg>
        <span>{item.label}</span><span className="nav-indicator" aria-hidden="true" />
      </Link>)}
    </nav>
    <div className="sidebar-bottom"><div className="user-card"><span className="avatar">林</span><div><strong>林同学</strong><small>求职者账户</small></div></div></div>
  </aside>;
}
