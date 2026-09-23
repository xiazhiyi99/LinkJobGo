import "./workspace.css";
import "./applications/applications.css";
import { WorkspaceSidebar } from "../../components/workspace/WorkspaceSidebar";
import { AuthGate } from "../../components/auth/AuthGate";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate><div className="workspace-shell"><WorkspaceSidebar /><main className="workspace-main">{children}</main></div></AuthGate>;
}
