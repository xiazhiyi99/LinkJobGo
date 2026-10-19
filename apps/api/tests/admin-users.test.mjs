import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { createAdminUsersService, websiteHost, parseUsersQuery } = require('../src/modules/admin-users/service');
const { createAdminUsersHandler } = require('../src/modules/admin-users/routes');

function fixture() {
  const rows = [
    { id: 'admin-a', email: 'admin-a@example.test', role: 'admin', profile: { name: '管理员甲' }, createdAt: new Date('2026-09-01T10:30:00Z'), emailVerifiedAt: new Date(), passwordHash: 'must-not-leak', sessions: [{ secret: 'must-not-leak' }] },
    { id: 'admin-b', email: 'admin-b@example.test', role: 'admin', profile: { name: '管理员乙' }, createdAt: new Date('2026-09-02T10:30:00Z'), emailVerifiedAt: new Date() },
    { id: 'ordinary', email: 'ordinary@example.test', role: 'user', profile: { name: '求职者甲' }, createdAt: new Date('2026-10-01T12:00:00Z'), emailVerifiedAt: null, unrelated: { skills: ['保留技能'], recordIds: ['education-1'] } },
  ];
  const applications = [
    { userId: 'ordinary', status: 'applied', jobUrl: 'https://zhaopin.meituan.com/apply/1?token=secret' },
    { userId: 'ordinary', status: 'interview', jobUrl: 'https://zhaopin.meituan.com/apply/2' },
    { userId: 'ordinary', status: 'saved', jobUrl: 'https://saved.example.test' },
    { userId: 'ordinary', status: 'closed', appliedOn: new Date(), jobUrl: 'https://app.mokahr.com/path#secret' },
    { userId: 'ordinary', status: 'closed', jobUrl: 'https://not-submitted.example.test' },
    { userId: 'ordinary', status: 'saved', submittedEvent: true, jobUrl: 'javascript:alert(1)' },
    { userId: 'ordinary', status: 'applied', jobUrl: null },
    { userId: 'admin-a', status: 'applied', jobUrl: 'https://other.example.test/' },
  ].map(row => ({ ...row, updatedAt: new Date('2026-10-19T10:00:00Z') }));
  const calls = [], audits = [];
  const selected = (row, select) => row && Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, key === '_count' ? { applications: applications.filter(a => a.userId === row.id).length } : row[key]]));
  const matches = (row, where = {}) => (!where.role || (typeof where.role === 'string' ? row.role === where.role : row.role !== where.role.not)) && (!where.OR || where.OR.some(filter => filter.email ? row.email.toLowerCase().includes(filter.email.contains.toLowerCase()) : row.profile?.name?.toLowerCase().includes(filter.profile.is.name.contains.toLowerCase())));
  const prisma = {
    user: {
      count: async ({ where }) => rows.filter(row => matches(row, where)).length,
      findMany: async args => { calls.push(args); return rows.filter(row => matches(row, args.where)).sort((a, b) => b.createdAt - a.createdAt).slice(args.skip, args.skip + args.take).map(row => selected(row, args.select)); },
      findUnique: async ({ where, select }) => selected(rows.find(row => row.id === where.id), select),
      update: async ({ where, data, select }) => { const row = rows.find(row => row.id === where.id); Object.assign(row, data); return selected(row, select); },
    },
    application: { groupBy: async args => {
      calls.push(args); const groups = new Map();
      for (const row of applications.filter(row => args.where.userId.in.includes(row.userId) && (['applied', 'screening', 'interview', 'offer'].includes(row.status) || row.appliedOn || row.submittedEvent))) {
        const key = JSON.stringify([row.userId, row.jobUrl]);
        const group = groups.get(key) ?? { userId: row.userId, jobUrl: row.jobUrl, _count: { _all: 0 }, _max: { updatedAt: row.updatedAt } };
        group._count._all++; groups.set(key, group);
      }
      return [...groups.values()];
    } },
    async $transaction(operation, options) { assert.equal(options.isolationLevel, 'Serializable'); return operation(prisma); },
  };
  return { rows, calls, audits, prisma, service: createAdminUsersService({ prisma, onRoleChange: event => audits.push(event) }) };
}

test('user catalogue is paginated and exposes registration, verification and submitted website aggregates only', async () => {
  const { rows, calls, service } = fixture();
  const result = await service.list(rows[0], { q: '求职者', role: 'user', pageSize: '10' });
  assert.equal(result.total, 1); assert.equal(result.items.length, 1);
  const user = result.items[0]; assert.equal(user.createdAt, '2026-10-01T12:00:00.000Z'); assert.equal(user.emailVerified, false);
  assert.equal(user.applicationCount, 7); assert.equal(user.submittedCount, 5); assert.equal(user.missingWebsiteCount, 2);
  assert.deepEqual(user.websites, [{ host: 'zhaopin.meituan.com', count: 2 }, { host: 'app.mokahr.com', count: 1 }]);
  assert.ok(!JSON.stringify(result).includes('secret')); assert.ok(!JSON.stringify(result).includes('passwordHash')); assert.ok(!JSON.stringify(result).includes('skills'));
  assert.deepEqual(calls[1].where.userId.in, ['ordinary']);
  assert.deepEqual(calls[0].select.profile, { select: { name: true } });
  const empty = await service.list(rows[0], { q: 'no-such-account' }); assert.equal(empty.items.length, 0);
  await assert.rejects(service.list(rows[2], {}), { code: 'ADMIN_REQUIRED' });
});
test('query validation and URL normalization avoid unbounded queries and leaking URL paths or credentials', () => {
  for (const query of [{ page: 0 }, { page: 1.5 }, { page: 100001 }, { pageSize: 1000 }, { role: 'operator' }, { q: 'x'.repeat(121) }]) assert.throws(() => parseUsersQuery(query), { code: 'INVALID_USERS_QUERY' });
  assert.equal(websiteHost('https://user:password@Example.COM./path?token=private#secret'), 'example.com');
  for (const value of [null, '', 'javascript:alert(1)', 'ftp://example.test/', 'invalid']) assert.equal(websiteHost(value), null);
});
test('pagination bounds user and application queries to the selected page', async () => {
  const { rows, service, calls } = fixture();
  for (let index = 0; index < 21; index++) rows.push({ id: `extra-${index}`, email: `extra-${index}@example.test`, role: 'user', createdAt: new Date(`2026-10-${String(index + 1).padStart(2, '0')}T10:00:00Z`), emailVerifiedAt: null });
  const result = await service.list(rows[0], { role: 'user', page: 2, pageSize: 10 });
  assert.equal(result.total, 22); assert.equal(result.page, 2); assert.equal(result.items.length, 10);
  assert.equal(calls[0].skip, 10); assert.equal(calls[0].take, 10);
  assert.deepEqual(calls[1].where.userId.in, result.items.map(row => row.id));
  assert.ok(result.items.every(row => row.role === 'user'));
});
test('role changes preserve account/profile data and record metadata-only audit events', async () => {
  const { rows, audits, service } = fixture(), actor = rows[0], target = rows[2];
  const before = structuredClone(target.unrelated);
  const result = await service.changeRole(actor, target.id, { role: 'admin', expectedRole: 'user' });
  assert.equal(result.user.role, 'admin'); assert.equal(result.changed, true); assert.deepEqual(target.unrelated, before);
  assert.equal(audits.length, 1); assert.equal(audits[0].actorUserId, actor.id); assert.equal(audits[0].previousRole, 'user');
  assert.ok(!JSON.stringify(audits).includes('@')); assert.ok(!JSON.stringify(audits).includes('skills'));
  assert.equal((await service.changeRole(actor, target.id, { role: 'admin', expectedRole: 'admin' })).changed, false);
  assert.equal(audits.length, 1);
  await service.changeRole(actor, target.id, { role: 'user', expectedRole: 'admin' }); assert.equal(target.role, 'user');
});
test('self changes, stale roles, malformed payloads and stale administrator principals cannot mutate permissions', async () => {
  const { rows, service, audits } = fixture();
  await assert.rejects(service.changeRole(rows[0], rows[0].id, { role: 'user', expectedRole: 'admin' }), { code: 'CANNOT_CHANGE_SELF_ROLE' });
  await assert.rejects(service.changeRole(rows[0], 'missing', { role: 'user', expectedRole: 'admin' }), { status: 404 });
  await assert.rejects(service.changeRole(rows[0], 'ordinary', { role: 'admin', expectedRole: 'admin' }), { code: 'ROLE_CONFLICT' });
  for (const payload of [null, [], { role: 'owner', expectedRole: 'user' }, { role: 'admin' }, { role: 'admin', expectedRole: 'user', passwordHash: 'injected' }]) await assert.rejects(service.changeRole(rows[0], 'ordinary', payload), { status: 400 });
  const staleActor = { ...rows[0] }; rows[0].role = 'user';
  await assert.rejects(service.changeRole(staleActor, 'ordinary', { role: 'admin', expectedRole: 'user' }), { code: 'ADMIN_REQUIRED' });
  assert.equal(rows[2].role, 'user'); assert.equal(audits.length, 0);
});
test('serialization failures are retried with a fresh authority check and bounded conflict response', async () => {
  const { rows, prisma } = fixture(); let attempts = 0;
  const transaction = prisma.$transaction;
  prisma.$transaction = async (...args) => { attempts++; if (attempts === 1) throw { code: 'P2034' }; return transaction(...args); };
  const service = createAdminUsersService({ prisma });
  await service.changeRole(rows[0], 'ordinary', { role: 'admin', expectedRole: 'user' }); assert.equal(attempts, 2);
  prisma.$transaction = async () => { throw { code: 'P2034' }; };
  await assert.rejects(service.changeRole(rows[0], 'ordinary', { role: 'user', expectedRole: 'admin' }), { code: 'ROLE_CONFLICT', status: 409 });
});

test('HTTP administration rejects ordinary users, untrusted writes, oversized bodies and non-JSON mutations', async () => {
  const f = fixture();
  const handler = createAdminUsersHandler({ service: f.service, authenticate: async req => f.rows.find(row => row.id === req.headers.cookie?.replace('session=', '')), allowedOrigins: ['https://platform.example.test'] });
  const server = createServer((req, res) => handler(req, res, new URL(req.url, 'http://local')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init = {}) => fetch(base + path, { ...init, headers: { cookie: 'session=admin-a', ...(init.headers || {}) } });
  const patch = (body, headers = {}) => request('/admin/users/ordinary/role', { method: 'PATCH', headers: { origin: 'https://platform.example.test', 'content-type': 'application/json', ...headers }, body });
  try {
    const list = await request('/admin/users'); assert.equal(list.status, 200); assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.equal((await request('/admin/users', { headers: { cookie: '' } })).status, 401);
    assert.equal((await request('/admin/users', { headers: { cookie: 'session=ordinary' } })).status, 403);
    assert.equal((await patch('{}', { origin: 'https://evil.test' })).status, 403);
    assert.equal((await patch('{}', { origin: '' })).status, 403);
    assert.equal((await patch('{}', { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await patch('{invalid')).status, 400);
    assert.equal((await patch(JSON.stringify({ padding: 'x'.repeat(4096) }))).status, 413);
    assert.equal((await request('/admin/users', { method: 'POST' })).status, 405);
    const preflight = await request('/admin/users/ordinary/role', { method: 'OPTIONS', headers: { origin: 'https://platform.example.test' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-methods'), 'PATCH');
    const promoted = await patch(JSON.stringify({ role: 'admin', expectedRole: 'user' })); assert.equal(promoted.status, 200);
    assert.equal((await request('/admin/users', { headers: { cookie: 'session=ordinary' } })).status, 200, 'role takes effect on the next authenticated request');
    await patch(JSON.stringify({ role: 'user', expectedRole: 'admin' }));
    assert.equal((await request('/admin/users', { headers: { cookie: 'session=ordinary' } })).status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
