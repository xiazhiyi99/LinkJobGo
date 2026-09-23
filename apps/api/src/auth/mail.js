const sendMail = async ({ to, subject, text }) => {
  const provider = String(process.env.MAIL_PROVIDER || (process.env.NODE_ENV === 'production' ? '' : 'console')).toLowerCase();
  if (provider === 'console') { console.log(`[mail:console] to=${to} subject=${subject}\n${text}`); return; }
  if (provider === 'resend') {
    if (!process.env.MAIL_API_KEY || !process.env.MAIL_FROM) throw new Error('MAIL_API_KEY 和 MAIL_FROM 未配置');
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${process.env.MAIL_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }) });
    if (!response.ok) throw new Error(`邮件服务返回 ${response.status}`);
    return;
  }
  throw new Error('未配置可用的 MAIL_PROVIDER');
};

module.exports = { sendMail };
