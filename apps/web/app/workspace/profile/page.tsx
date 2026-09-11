import { WorkspaceHeader } from "../../../components/workspace/WorkspaceHeader";
import { PlaceholderPanel } from "../../../components/workspace/PlaceholderPanel";
import { featureContent } from "../../../features/workspace/profile/content";

export default function FeaturePage() {
  return <div className="workspace-content"><WorkspaceHeader title="个人资料" /><PlaceholderPanel feature={featureContent} /></div>;
}
