export function WorkspaceHeader({ title = "工作台" }: { title?: string }) {
  return <header className="workspace-header"><div><p className="workspace-date">2026 年 9 月 11 日 · 星期五</p><h1>{title}</h1></div><button className="help-button" type="button">帮助与反馈</button></header>;
}
