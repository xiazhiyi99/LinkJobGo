import type { Metadata } from 'next';
import { WorkspaceHeader } from '../../../../components/workspace/WorkspaceHeader';
import { UsersManagement } from '../../../../features/admin/UsersManagement';

export const metadata: Metadata = { title: '用户管理 · 领客', description: '管理账号权限、注册信息与投递概况。' };
export default function AdminUsersPage() {
  return <div className="workspace-content"><WorkspaceHeader title="用户管理" /><UsersManagement /></div>;
}
