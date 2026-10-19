import type { Metadata } from 'next';
import { WorkspaceHeader } from '../../../../components/workspace/WorkspaceHeader';
import { SiteRulesManagement } from '../../../../features/admin/SiteRulesManagement';

export const metadata: Metadata = { title: '网站规则 · 领客管理', description: '查看当前后端代码中的网站规则注册目录。' };
export default function AdminSiteRulesPage() {
  return <div className="workspace-content"><WorkspaceHeader title="规则管理" /><SiteRulesManagement /></div>;
}
