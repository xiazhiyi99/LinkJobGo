const boolEnv = (value, fallback) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const smtpOptions = (env) => {
  const host = String(env.SMTP_HOST || '').trim();
  const port = Number(env.SMTP_PORT || 465);
  const user = String(env.SMTP_USER || '').trim();
  const password = String(env.SMTP_PASSWORD || '');
  const from = String(env.MAIL_FROM || '').trim();
  const fromAddress = (from.match(/<([^<>]+)>$/)?.[1] || from).trim();

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !password || !from) {
    throw new Error('SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASSWORD 和 MAIL_FROM 必须正确配置');
  }
  if (fromAddress.toLowerCase() !== user.toLowerCase()) {
    throw new Error('MAIL_FROM 的邮箱地址必须与 SMTP_USER 一致');
  }
  return {
    host,
    port,
    secure: boolEnv(env.SMTP_SECURE, port === 465),
    requireTLS: boolEnv(env.SMTP_REQUIRE_TLS, port === 80),
    auth: { user, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  };
};

const createMailSender = ({ env = process.env, createTransport, fetchImpl = fetch, logger = console } = {}) => async ({ to, subject, text }) => {
  const provider = String(env.MAIL_PROVIDER || (env.NODE_ENV === 'production' ? '' : 'console')).toLowerCase();
  if (provider === 'console') {
    logger.log(`[mail:console] to=${to} subject=${subject}\n${text}`);
    return;
  }
  if (provider === 'smtp') {
    const transport = (createTransport || require('nodemailer').createTransport)(smtpOptions(env));
    try {
      await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
    } finally {
      transport.close?.();
    }
    return;
  }
  if (provider === 'resend') {
    if (!env.MAIL_API_KEY || !env.MAIL_FROM) throw new Error('MAIL_API_KEY 和 MAIL_FROM 未配置');
    const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.MAIL_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }) });
    if (!response.ok) throw new Error(`邮件服务返回 ${response.status}`);
    return;
  }
  throw new Error('未配置可用的 MAIL_PROVIDER');
};

const sendMail = createMailSender();

module.exports = { sendMail, createMailSender, smtpOptions };
