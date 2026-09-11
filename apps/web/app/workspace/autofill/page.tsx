import { WorkspaceHeader } from "../../../components/workspace/WorkspaceHeader";
import { PlaceholderPanel } from "../../../components/workspace/PlaceholderPanel";
import { featureContent } from "../../../features/workspace/autofill/content";

export default function FeaturePage() {
  return <div className="workspace-content"><WorkspaceHeader title="智能填写" /><PlaceholderPanel feature={featureContent} /></div>;
}
