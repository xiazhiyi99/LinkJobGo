const { AuthenticationError } = require('../../auth/request-user');
const { accountRole } = require('../../auth/roles');
const { AdminUsersError } = require('./service');

async function readInput(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new AdminUsersError('JSON_REQUIRED', '请使用 JSON 请求', 415);
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, oversized = false;
    req.on('data', chunk => {
      if (oversized) return;
      size += chunk.length;
      if (size > 2048) { oversized = true; chunks.length = 0; reject(new AdminUsersError('REQUEST_TOO_LARGE', '请求内容过大', 413)); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new AdminUsersError('INVALID_JSON', '请求数据格式错误', 400)); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new AdminUsersError('REQUEST_ABORTED', '请求已中断', 400)));
  });
}

const createAdminUsersHandler = ({ service, authenticate, allowedOrigins = [] }) => async (req, res, url) => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' };
  const send = (status, payload) => { res.writeHead(status, headers); res.end(JSON.stringify(payload)); };
  try {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) throw new AdminUsersError('ORIGIN_DENIED', '来源不被允许', 403);
    if (origin) { headers['access-control-allow-origin'] = origin; headers['access-control-allow-credentials'] = 'true'; }
    const target = url.pathname.match(/^\/admin\/users\/([A-Za-z0-9_-]{1,128})\/role$/);
    const collection = url.pathname === '/admin/users';
    if (!target && !collection) throw new AdminUsersError('NOT_FOUND', '接口不存在', 404);
    const method = collection ? 'GET' : 'PATCH';
    if (req.method === 'OPTIONS') { headers['access-control-allow-methods'] = method; headers['access-control-allow-headers'] = 'content-type, authorization'; res.writeHead(204, headers); res.end(); return; }
    if (req.method !== method) { headers.allow = method; throw new AdminUsersError('METHOD_NOT_ALLOWED', '请求方法不支持', 405); }
    const actor = await authenticate(req);
    if (!actor?.id) throw new AdminUsersError('AUTHENTICATION_REQUIRED', '请先登录', 401);
    if (accountRole(actor) !== 'admin') throw new AdminUsersError('ADMIN_REQUIRED', '仅管理员可管理用户', 403);
    if (collection) return send(200, await service.list(actor, Object.fromEntries(url.searchParams)));
    // Cookie-authenticated privilege changes require a trusted browser origin.
    // This also protects deployments whose cookie SameSite policy is changed.
    if (!origin) throw new AdminUsersError('ORIGIN_REQUIRED', '权限修改需要受信任的页面来源', 403);
    return send(200, await service.changeRole(actor, target[1], await readInput(req)));
  } catch (error) {
    const known = error instanceof AdminUsersError || error instanceof AuthenticationError;
    send(known ? error.status : 500, { error: known ? error.message : '用户管理暂不可用', code: known ? error.code : 'ADMIN_USERS_UNAVAILABLE' });
  }
};
module.exports = { createAdminUsersHandler };
