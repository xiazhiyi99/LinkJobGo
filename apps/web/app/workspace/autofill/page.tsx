import type { Metadata } from "next";
import { WorkspaceHeader } from "../../../components/workspace/WorkspaceHeader";
import { AutofillGuide } from "../../../features/workspace/autofill/AutofillGuide";

export const metadata: Metadata = { title: "智能填写 · 领客", description: "下载领客扩展，跟随安装与使用演示，在招聘页面填写简历。" };

export default function AutofillPage() {
  return <div className="workspace-content"><WorkspaceHeader title="智能填写" /><AutofillGuide /></div>;
}
