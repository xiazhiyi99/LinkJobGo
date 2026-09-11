import "./workspace.css";
import { WorkspaceSidebar } from "../../components/workspace/WorkspaceSidebar";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <div className="workspace-shell"><WorkspaceSidebar /><main className="workspace-main">{children}</main></div>;
}
