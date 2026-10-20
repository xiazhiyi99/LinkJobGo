'use strict';

// Only stable error codes cross the Python boundary. Provider responses can
// contain account details or credentials and must never be returned verbatim.
function imapConnectionError(provider, caught) {
  const credential = provider.authMode === 'authorization_code' ? '授权码' : provider.authMode === 'app_password' ? '应用专用密码' : '密码';
  const errors = {
    IMAP_AUTH_FAILED: [`邮箱地址或${credential}错误，请核对后重试${credential === '密码' ? '。' : `，或重新生成${credential}。`}`, 400],
    IMAP_NOT_ENABLED: ['邮箱未开启 IMAP/SMTP 服务，请在邮箱设置中开启后重试。', 400],
    IMAP_ACCESS_DENIED: ['邮箱服务商拒绝了此次登录，请先在邮箱网页版完成安全验证或解除登录限制后重试。', 403],
    IMAP_RATE_LIMITED: ['邮箱登录尝试过于频繁，请稍后重试。', 429],
    IMAP_TIMEOUT: ['连接邮箱服务器超时，请稍后重试。', 504],
    IMAP_TLS_FAILED: ['无法与邮箱服务器建立安全连接，请检查服务器地址和 TLS 配置。', 502],
    IMAP_REQUEST_FAILED: ['已连接邮箱，但无法读取收件箱，请检查邮箱服务设置后重试。', 502],
    IMAP_INVALID_RESPONSE: ['邮箱连接服务返回异常，请稍后重试。', 502],
    IMAP_CONNECTION_FAILED: ['无法连接邮箱服务器，请检查服务器地址或稍后重试。', 502],
  };
  const aliases = { EAUTH: 'IMAP_AUTH_FAILED', AUTHENTICATIONFAILED: 'IMAP_AUTH_FAILED', ETIMEDOUT: 'IMAP_TIMEOUT', ESOCKETTIMEDOUT: 'IMAP_TIMEOUT' };
  const code = Object.hasOwn(aliases, caught?.code) ? aliases[caught.code] : Object.hasOwn(errors, caught?.code) ? caught.code : 'IMAP_CONNECTION_FAILED';
  const [message, status] = errors[code];
  return Object.assign(new Error(message), { code, status });
}

module.exports = { imapConnectionError };
