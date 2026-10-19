import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { createAdminUsersService } from '../src/modules/admin-users/service.js';

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname) && database.pathname.endsWith('_admin_test'), 'Explicit local *_admin_test database required');
const prisma = new PrismaClient({ datasourceUrl: database.href });
const run = `users-${randomUUID().slice(0, 8)}`, ids = [], checks = [];
const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const origin = 'http://127.0.0.1:3710';
let api;
try {
  const create = async (suffix, role) => {
    const user = await prisma.user.create({ data: { email: `${run}-${suffix}@example.test`, role, passwordHash: 'synthetic-test-only', emailVerifiedAt: new Date(), profile: { create: { name: `合成测试 ${suffix}` } }, skills: { create: { name: '保留技能' } }, educations: { create: { school: '保留学校' } } } }); ids.push(user.id);
    const session = await prisma.session.create({ data: { userId: user.id, type: 'web', expiresAt: new Date(Date.now() + 3600000) } });
    return { user, cookie: `lingke_admin_test=${session.id}` };
  };
  const a = await create('admin-a', 'admin'), b = await create('admin-b', 'admin'), ordinary = await create('ordinary', 'user');
  await prisma.application.createMany({ data: [
    { userId: ordinary.user.id, company: '测试甲', title: '', status: 'applied', jobUrl: 'https://zhaopin.meituan.com/web/delivery-confirm?token=private' },
    { userId: ordinary.user.id, company: '测试乙', title: '', status: 'interview', jobUrl: 'https://zhaopin.meituan.com/another' },
    { userId: ordinary.user.id, company: '仅收藏', title: '', status: 'saved', jobUrl: 'https://saved.example.test/' },
    { userId: ordinary.user.id, company: '已结束投递', title: '', status: 'closed', appliedOn: new Date(), jobUrl: 'https://app.mokahr.com/path' },
    { userId: ordinary.user.id, company: '缺链接', title: '', status: 'applied' },
  ] });
  const historical = await prisma.application.create({ data: { userId: ordinary.user.id, company: '已结束事件', title: '', status: 'closed', jobUrl: 'https://event.example.test/path' } });
  await prisma.applicationEvent.create({ data: { userId: ordinary.user.id, applicationId: historical.id, type: 'application.submitted', clientEventId: run } });
  const source = () => prisma.user.findUnique({ where: { id: ordinary.user.id }, select: { passwordHash: true, profile: true, skills: true, educations: true, applications: { orderBy: { id: 'asc' } } } });
  const before = await source();
  api = spawn(process.execPath, ['src/index.js'], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'development', API_PORT: String(port), DATABASE_URL: database.href, WEB_ORIGIN: origin, SESSION_COOKIE_NAME: 'lingke_admin_test', SESSION_COOKIE_PATH: '/', SESSION_COOKIE_SECURE: 'false', AI_PROVIDER_MODE: 'fake', MAIL_PROVIDER: 'console' } });
  api.stdout.resume(); api.stderr.resume();
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(ready, 'API must start');
  const request = async (path, account, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'PATCH' : 'GET', headers: { origin, 'content-type': 'application/json', ...(account ? { cookie: account.cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request('/admin/users')).status, 401);
  assert.equal((await request('/admin/users', ordinary)).status, 403);
  const result = await request(`/admin/users?q=${run}`, a); assert.equal(result.status, 200); assert.equal(result.body.total, 3);
  const summary = result.body.items.find(row => row.id === ordinary.user.id);
  assert.equal(summary.applicationCount, 6); assert.equal(summary.submittedCount, 5); assert.equal(summary.missingWebsiteCount, 1);
  assert.deepEqual(summary.websites, [{ host: 'zhaopin.meituan.com', count: 2 }, { host: 'app.mokahr.com', count: 1 }, { host: 'event.example.test', count: 1 }]);
  assert.ok(!JSON.stringify(result.body).includes('private')); checks.push('postgres_website_aggregation_and_auth');
  const endpoint = `/admin/users/${ordinary.user.id}/role`;
  assert.equal((await request(endpoint, a, { role: 'admin', expectedRole: 'user' })).status, 200);
  assert.equal((await request('/admin/users', ordinary)).status, 200);
  assert.equal((await request(endpoint, b, { role: 'admin', expectedRole: 'user' })).status, 409);
  assert.equal((await request(endpoint, a, { role: 'user', expectedRole: 'admin' })).status, 200);
  assert.equal((await request('/admin/users', ordinary)).status, 403);
  assert.deepEqual(await source(), before); checks.push('role_change_immediate_and_profile_application_preservation');
  assert.equal((await request(`/admin/users/${a.user.id}/role`, a, { role: 'user', expectedRole: 'admin' })).status, 409); checks.push('self_role_change_denied');

  // Hold both concurrent demotions after reading the administrator count. This
  // exercises PostgreSQL SSI rather than relying on a mock transaction.
  let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const wrapped = { $transaction: (operation, options) => prisma.$transaction(tx => operation(new Proxy(tx, { get(target, property) {
    if (property !== 'user') return Reflect.get(target, property);
    return new Proxy(tx.user, { get(delegate, key) {
      if (key !== 'count') return Reflect.get(delegate, key);
      return async args => { const value = await delegate.count(args); if (arrivals < 2) { arrivals++; if (arrivals === 2) release(); await barrier; } return value; };
    } });
  } })), options) };
  const service = createAdminUsersService({ prisma: wrapped });
  const concurrent = await Promise.allSettled([service.changeRole(a.user, b.user.id, { role: 'user', expectedRole: 'admin' }), service.changeRole(b.user, a.user.id, { role: 'user', expectedRole: 'admin' })]);
  assert.equal(concurrent.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(await prisma.user.count({ where: { role: 'admin' } }), 1);
  assert.ok(['ADMIN_REQUIRED', 'ROLE_CONFLICT'].includes(concurrent.find(row => row.status === 'rejected').reason.code)); checks.push('concurrent_administrators_cannot_demote_each_other_to_zero');
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  api?.kill();
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
