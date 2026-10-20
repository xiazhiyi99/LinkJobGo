const names: Record<string, string> = { gmail: 'Gmail', outlook: 'Outlook', qq: 'QQ 邮箱', '163': '网易 163', '126': '网易 126', icloud: 'iCloud', imap: '其他邮箱' };
export const providerName = (id: string) => names[id] || id;
export const mailProviderLabel = (provider: { id: string; name: string; label?: string }) => names[provider.id] || provider.label || provider.name;

export function mailCredential(provider: { id: string; authModes?: string[] }) {
  const modes = provider.authModes || [];
  const authorizationHelp = provider.id === 'qq'
    ? { help: '获取位置：QQ 邮箱网页版 → 设置 → 账号与安全 → 安全设置，开启 IMAP/SMTP 服务后生成授权码。', helpUrl: 'https://help.mail.qq.com/detail/106/985' }
    : ['126', '163'].includes(provider.id)
      ? { help: `获取位置：网易 ${provider.id} 邮箱网页版 → 设置 → POP3/SMTP/IMAP → 新增授权密码，按提示完成验证。`, helpUrl: 'https://help.mail.126.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac286624f309a1a7089' }
      : { help: '请在邮箱网页版的账户安全或客户端设置中开启 IMAP/SMTP 服务，并生成授权码。', helpUrl: '' };
  if (['qq', '126', '163'].includes(provider.id) || modes.includes('authorization_code')) {
    return { label: '授权码', placeholder: '请输入邮箱设置中生成的 IMAP 授权码', ...authorizationHelp };
  }
  if (provider.id === 'icloud' || modes.includes('app_password')) {
    return { label: '应用专用密码', placeholder: '请输入 Apple 账户中生成的应用专用密码', help: '获取位置：Apple 账户 → 登录和安全 → App 专用密码 → 生成 App 专用密码。', helpUrl: 'https://support.apple.com/zh-cn/102654' };
  }
  return { label: '密码', placeholder: '请输入邮箱密码', help: '请先在邮箱设置中开启 IMAP 服务。', helpUrl: '' };
}
