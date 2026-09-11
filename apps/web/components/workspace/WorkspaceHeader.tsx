import Link from "next/link";
export function WorkspaceHeader({ title }: { title: string }) {
  return <header className="workspace-header"><div className="workspace-breadcrumb"><span>求职空间</span><span aria-hidden="true">/</span><h1>{title}</h1></div><Link href="/" className="workspace-home-link">领客首页 <span aria-hidden="true">↗</span></Link></header>;
}
