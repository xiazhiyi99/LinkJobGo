"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { workspaceNavigation } from "../../features/workspace/navigation";

export function WorkspaceSidebar() {
  const pathname = usePathname();
  return <aside className="workspace-sidebar">
    <Link className="workspace-brand" href="/">领客<span>.</span></Link>
    <div className="workspace-nav-label">工作空间</div>
    <nav className="workspace-nav" aria-label="工作台导航">
      {workspaceNavigation.map((item) => <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}><span className="nav-icon">{item.icon}</span>{item.label}</Link>)}
    </nav>
    <div className="sidebar-footer"><span className="avatar">林</span><div><strong>林同学</strong><small>求职者账户</small></div></div>
  </aside>;
}
