const names: Record<string, string> = { gmail: 'Gmail', outlook: 'Outlook', qq: 'QQ 邮箱', '163': '网易 163', '126': '网易 126', icloud: 'iCloud', imap: '其他邮箱' };
export const providerName = (id: string) => names[id] || id;
export const mailProviderLabel = (provider: { id: string; name: string; label?: string }) => names[provider.id] || provider.label || provider.name;
