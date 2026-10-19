export type AccountRole = 'admin' | 'user';
export interface ManagedUser {
  id: string; email: string; name: string | null; role: AccountRole; createdAt: string; emailVerified: boolean;
  applicationCount: number; submittedCount: number; websites: { host: string; count: number }[]; missingWebsiteCount: number; lastApplicationAt: string | null;
}
export interface UsersPage { items: ManagedUser[]; page: number; pageSize: number; total: number }
export const roleLabel = (role: AccountRole) => role === 'admin' ? '管理员' : '普通用户';
export const canChangeUserRole = (actor: { id: string; role?: string } | null, target: { id: string }) => actor?.role === 'admin' && actor.id !== target.id;
export const roleChangeExplanation = (role: AccountRole) => role === 'admin' ? '管理员可以查看用户信息、调整其他账号权限，并使用规则管理和扩展调试功能。' : '调整后，该账号将无法访问管理页和扩展调试功能，个人资料与投递记录保留。';
export const formatAdminDate = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
