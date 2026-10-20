const names: Record<string, string> = { gmail: 'Gmail', outlook: 'Outlook', qq: 'QQ 邮箱', '163': '网易 163', '126': '网易 126', icloud: 'iCloud', imap: '其他邮箱' };
export const providerName = (id: string) => names[id] || id;
export const mailProviderLabel = (provider: { id: string; name: string; label?: string }) => names[provider.id] || provider.label || provider.name;

export function mailCredential(provider: { id: string; authModes?: string[] }) {
  const modes = provider.authModes || [];
  if (['qq', '126', '163'].includes(provider.id) || modes.includes('authorization_code')) {
    return { label: '授权码', placeholder: '请输入邮箱设置中生成的 IMAP 授权码' };
  }
  if (provider.id === 'icloud' || modes.includes('app_password')) {
    return { label: '应用专用密码', placeholder: '请输入 Apple 账户中生成的应用专用密码' };
  }
  return { label: '密码', placeholder: '请输入邮箱密码' };
}
