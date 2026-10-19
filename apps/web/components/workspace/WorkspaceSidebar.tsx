"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { workspaceNavigation } from "../../features/workspace/navigation";
import { useAccount } from "../auth/AuthGate";
import { isAdminAccount } from "../../features/admin/site-rules";
import { routes } from "../../lib/routes";

function NavigationIcon({ name }: { name: "person" | "autofill" | "rules" | "users" }) {
  if (name === "users") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/></svg>;
  if (name === "rules") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11M12 13h5M12 16h3"/></svg>;
  if (name === "autofill") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m8 12 2 2 5-5M8 17h8"/></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M4 3h16"/></svg>;
}

export function WorkspaceSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const account = useAccount();
  const admin = isAdminAccount(account);
  const personalCenter = workspaceNavigation[0];
  const isPersonalCenter = pathname.startsWith("/workspace/profile") || pathname === "/workspace/applications";
  const [expanded, setExpanded] = useState(isPersonalCenter);

  const handlePersonalCenterClick = () => {
    // The parent item is also the entry point for the personal home page.
    // When already inside the group, keep the click useful as an expand /
    // collapse control; from elsewhere it opens the home page and expands it.
    if (!isPersonalCenter || pathname !== personalCenter.href) {
      setExpanded(true);
      router.push(personalCenter.href);
      return;
    }
    setExpanded((value) => !value);
  };

  return <aside className="workspace-sidebar">
    <Link className="workspace-brand" href="/" aria-label="领客首页">领客<span className="brand-dot">.</span></Link>
    <nav className="workspace-nav" aria-label="工作台导航">
      <div className={`workspace-nav-group${expanded ? " is-expanded" : ""}`}>
        <button className={`workspace-nav-group-toggle${isPersonalCenter ? " active" : ""}`} type="button" aria-expanded={expanded} onClick={handlePersonalCenterClick}>
          <NavigationIcon name="person" />
          <span>{personalCenter.label}</span>
          <span className="workspace-nav-chevron" aria-hidden="true">⌄</span>
        </button>
        <div className="workspace-subnav" aria-label="个人中心">
          {personalCenter.children.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={pathname === item.href ? "active" : ""}>
            <span className="workspace-subnav-dot" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>)}
        </div>
      </div>
      {workspaceNavigation.slice(1).map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={pathname === item.href ? "active" : ""}>
        <NavigationIcon name={item.icon} />
        <span>{item.label}</span><span className="nav-indicator" aria-hidden="true" />
      </Link>)}
      {admin && <Link href={routes.adminSiteRules} aria-current={pathname === routes.adminSiteRules ? "page" : undefined} className={pathname === routes.adminSiteRules ? "active" : ""}><NavigationIcon name="rules" /><span>规则管理</span><span className="nav-indicator" aria-hidden="true" /></Link>}
      {admin && <Link href={routes.adminUsers} aria-current={pathname === routes.adminUsers ? "page" : undefined} className={pathname === routes.adminUsers ? "active" : ""}><NavigationIcon name="users" /><span>用户管理</span><span className="nav-indicator" aria-hidden="true" /></Link>}
    </nav>
    <div className="sidebar-bottom"><div className="user-card"><span className="avatar">林</span><div><strong>林同学</strong><small>{admin ? '管理员账户' : '求职者账户'}</small></div></div></div>
  </aside>;
}
