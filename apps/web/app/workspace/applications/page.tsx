import { WorkspaceHeader } from "../../../components/workspace/WorkspaceHeader";
import { PlaceholderPanel } from "../../../components/workspace/PlaceholderPanel";
import { featureContent } from "../../../features/workspace/applications/content";

export default function FeaturePage() {
  return <div className="workspace-content"><WorkspaceHeader title="投递航迹" /><PlaceholderPanel feature={featureContent} /></div>;
}
