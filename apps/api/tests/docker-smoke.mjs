// Exercises built production images against an ephemeral database, never .env.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const docker = process.env.DOCKER_BIN || 'docker';
const apiImage = process.env.API_TEST_IMAGE || 'lingke-api:p4-test';
const webImage = process.env.WEB_TEST_IMAGE || 'lingke-web:p4-test';
const prefix = `lingke-p4-${randomUUID().slice(0, 8)}`;
const names = { network: prefix, db: `${prefix}-db`, api: `${prefix}-api`, web: `${prefix}-web` };
const password = 'Synthetic-Docker-Password-2026';
const dbUrl = 'postgresql://postgres:synthetic-db-only@db:5432/autofill_p4_test';
const allowedOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const accounts = ['verified-a', 'verified-b', 'unverified'].map(name => `${name}@example.test`);
const checks = [];
const run = (args, options = {}) => execFileSync(docker, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000, ...options }).trim();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await wait(200); }
  throw new Error('Timed out: ' + label);
}
const mappedOrigin = (container, port) => 'http://' + run(['port', container, `${port}/tcp`]);
const metadata = extra => ({ protocolVersion: 'autofill.next.v2', requestId: randomUUID(), runId: 'docker-smoke', deadlineAt: Date.now() + 8000, ...extra });
const section = (id, label, fields, repeatable = false) => ({ sectionId: id, label, mode: 'inline', repeatable, records: [{ viewId: `${id}-1`, fields: fields.map((label, i) => ({ fieldId: `${id}-${i}`, label, kind: 'text', required: false, currentState: 'empty', hints: {} })) }], actions: [] });

try {
  for (const image of [apiImage, webImage]) run(['image', 'inspect', image]);
  run(['network', 'create', names.network]);
  run(['run', '--rm', '-d', '--name', names.db, '--network', names.network, '--network-alias', 'db', '-e', 'POSTGRES_PASSWORD=synthetic-db-only', '-e', 'POSTGRES_DB=autofill_p4_test', 'postgres:16-alpine']);
  await until(() => { try { run(['exec', names.db, 'pg_isready', '-U', 'postgres', '-d', 'autofill_p4_test']); return true; } catch { return false; } }, 'PostgreSQL');
  run(['run', '--rm', '--network', names.network, '-e', `DATABASE_URL=${dbUrl}`, apiImage, 'pnpm', 'exec', 'prisma', 'migrate', 'deploy', '--schema', 'src/prisma/schema.prisma']);
  checks.push('production image applies all existing migrations');
  // Seed only authentication identities; profile data is written through HTTP.
  run(['run', '--rm', '-i', '--network', names.network, '-e', `DATABASE_URL=${dbUrl}`, apiImage, 'node'], { input: `
    const { PrismaClient } = require('@prisma/client');
    const crypto = require('node:crypto');
    const prisma = new PrismaClient();
    (async () => {
      for (const [index,email] of ${JSON.stringify(accounts)}.entries()) {
        const salt=crypto.randomBytes(16).toString('hex');
        const passwordHash='scrypt$'+salt+'$'+crypto.scryptSync(${JSON.stringify(password)},salt,64).toString('hex');
        await prisma.user.create({data:{email,passwordHash,...(index<2?{emailVerifiedAt:new Date()}: {})}});
      }
    })().catch(() => { process.exitCode=1; }).finally(() => prisma.$disconnect());
  ` });
  run(['run', '--rm', '-d', '--name', names.api, '--network', names.network, '-p', '127.0.0.1::3001', '-e', `DATABASE_URL=${dbUrl}`, '-e', 'API_PORT=3001', '-e', 'EMAIL_CODE_SECRET=synthetic-docker-test-only', '-e', `AUTOFILL_EXTENSION_ORIGINS=${allowedOrigin}`, '-e', 'AI_PROVIDER_MODE=http', apiImage]);
  const base = mappedOrigin(names.api, 3001);
  await until(async () => { try { return (await fetch(base + '/health', { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } }, 'production API');
  assert.equal(run(['exec', names.api, 'node', '-p', 'process.env.NODE_ENV']), 'production');
  run(['exec', names.api, 'sh', '-c', 'test ! -e /app/.env && test ! -e /app/apps/api/.env']);
  checks.push('API production startup and environment isolation');
  async function request(path, { body, token, method = body ? 'POST' : 'GET', origin } = {}) {
    const response = await fetch(base + path, { method, signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  }
  async function login(email) {
    const result = await request('/auth/extension/login', { body: { email, password } });
    assert.equal(result.status, 200); assert.ok(result.body.accessToken);
    return result.body.accessToken;
  }
  const tokenA = await login(accounts[0]), tokenB = await login(accounts[1]), unverified = await login(accounts[2]);
  assert.equal((await request('/autofill/v2/readiness', { body: metadata() })).status, 401);
  assert.equal((await request('/autofill/v2/readiness', { body: metadata(), token: unverified })).status, 403);
  assert.equal((await request('/autofill/v2/readiness', { method: 'OPTIONS', origin: allowedOrigin })).status, 204);
  assert.equal((await request('/autofill/v2/readiness', { body: metadata(), token: tokenA, origin: 'https://unlisted.example.test' })).status, 403);
  checks.push('production verification, missing auth and exact-origin CORS');

  const expectedSchools = ['容器合成甲大学', '容器合成乙大学'];
  const written = await request('/profiles/me', { method: 'PATCH', token: tokenA, body: { profile: { name: '容器合成甲' }, records: { 教育经历: expectedSchools.map((school, index) => ({ school, degree: index ? '硕士' : '本科', startDate: '2018-09', endDate: '2022-06' })) } } });
  assert.equal(written.status, 200);
  assert.equal((await request('/profiles/me', { method: 'PATCH', token: tokenB, body: { profile: { name: '容器合成乙' } } })).status, 200);
  const resume = await request('/profiles/me/autofill-context', { token: tokenA });
  assert.equal(resume.status, 200); assert.equal(resume.body.schemaVersion, 'resume.autofill.v1');
  assert.deepEqual(resume.body.records.map(record => record.fields.school), expectedSchools);
  const ready = await request('/autofill/v2/readiness', { body: metadata(), token: tokenA, origin: allowedOrigin });
  assert.equal(ready.status, 200); assert.equal(ready.body.data.profileVersion, resume.body.profileVersion);
  assert.equal(ready.headers.get('access-control-allow-origin'), allowedOrigin);
  const snapshot = { protocolVersion: 'autofill.next.v2', documentId: 'docker-doc', pageRevision: 1, page: { origin: 'https://zhaopin.meituan.com', path: '/web/delivery-confirm', title: 'Synthetic Docker contract' }, sections: [section('basic', '基本信息', ['姓名']), section('education', '教育经历', ['学校'], true)] };
  const analyzed = await request('/autofill/v2/analyze', { token: tokenA, body: metadata({ snapshot }) });
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.body.data.sections[0].bindings[0].resolvedBy, 'site');
  const input = { snapshot, semanticPage: analyzed.body.data, scope: { sectionIds: ['basic', 'education'] }, optionEvidence: [] };
  const planned = await request('/autofill/v2/plan', { token: tokenA, body: metadata({ ...input, expectedProfileVersion: ready.body.data.profileVersion }) });
  assert.equal(planned.status, 200);
  assert.equal(planned.body.data.sections[0].records[0].assignments[0].value, '容器合成甲');
  assert.deepEqual(planned.body.data.sections[1].records.map(record => record.assignments[0].value), expectedSchools);
  assert.equal(planned.headers.get('cache-control'), 'no-store');
  checks.push('database projection and all three routes; registered rules work without AI credentials');

  const other = await request('/autofill/v2/plan', { token: tokenB, body: metadata(input) });
  assert.equal(other.status, 200); assert.equal(other.body.data.sections[0].records[0].assignments[0].value, '容器合成乙');
  assert.ok(!JSON.stringify(other.body).includes(expectedSchools[0]));
  await request('/profiles/me', { token: tokenA, method: 'PATCH', body: { profile: { name: '容器合成甲已更新' } } });
  assert.equal((await request('/autofill/v2/plan', { token: tokenA, body: metadata({ ...input, expectedProfileVersion: ready.body.data.profileVersion }) })).status, 409);
  assert.equal((await request('/auth/extension/logout', { token: tokenA, body: {} })).status, 200);
  assert.equal((await request('/autofill/v2/readiness', { token: tokenA, body: metadata() })).status, 401);
  checks.push('account isolation, profile version conflict and logout revocation');

  run(['run', '--rm', '-d', '--name', names.web, '--network', names.network, '-p', '127.0.0.1::3000', webImage]);
  const webBase = mappedOrigin(names.web, 3000);
  await until(async () => { try { return (await fetch(webBase, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } }, 'production Web');
  const home = await (await fetch(webBase)).text();
  assert.ok(home.includes('/_next/'));
  assert.equal((await fetch(webBase + '/login')).status, 200);
  const asset = home.match(/(?:src|href)="([^" ]+\/_next\/static\/[^" ]+)"/) || home.match(/(?:src|href)="(\/_next\/static\/[^" ]+)"/);
  assert.ok(asset); assert.equal((await fetch(new URL(asset[1].replaceAll('&amp;', '&'), webBase))).status, 200);
  run(['exec', names.web, 'sh', '-c', 'test ! -e /app/.env && test ! -e /app/apps/web/.env.local && test ! -e /app/apps/web/.env']);
  checks.push('Web production startup, login page, static assets and no local env files');
  console.log(JSON.stringify({ apiImage, webImage, checks, recruitmentBrowserTest: 'not included' }, null, 2));
} finally {
  for (const name of [names.web, names.api, names.db]) { try { run(['rm', '-f', '-v', name]); } catch {} }
  try { run(['network', 'rm', names.network]); } catch {}
}
