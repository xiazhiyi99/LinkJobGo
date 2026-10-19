const { ServiceError } = require('./errors');
const { accountRole } = require('../../auth/roles');

// A code catalogue only: no profile access, database writes or AI requests.
const createSiteRulesAdminHandler = ({ authenticate, list, allowedOrigins = [] }) => async (req, res) => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' };
  const send = (status, data) => { res.writeHead(status, headers); res.end(JSON.stringify(data)); };
  try {
    const origin = req.headers.origin;
    if (origin) {
      if (!allowedOrigins.includes(origin)) throw new ServiceError('origin-denied', '来源不被允许', 403);
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-credentials'] = 'true';
    }
    if (req.method === 'OPTIONS' && origin) {
      res.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'content-type, authorization' }); res.end(); return;
    }
    if (req.method !== 'GET') { headers.allow = 'GET'; throw new ServiceError('method-not-allowed', '此目录只支持读取', 405); }
    const user = await authenticate(req);
    if (!user?.id) throw new ServiceError('authentication-required', '请先登录', 401);
    if (accountRole(user) !== 'admin') throw new ServiceError('ADMIN_REQUIRED', '仅管理员可查看规则目录', 403);
    send(200, { source: 'code', generatedAt: new Date().toISOString(), sites: list() });
  } catch (error) {
    const failure = error instanceof ServiceError ? error : new ServiceError('internal-error', '规则目录暂不可用', 500);
    send(failure.status, { error: failure.message, code: failure.code });
  }
};
module.exports = { createSiteRulesAdminHandler };
