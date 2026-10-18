// Read-only product-code acceptance runner. Mutations are limited to the
// designated synthetic account in the isolated /autofill-test deployment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const base = 'https://linkaigo.com/autofill-test/api';
const web = 'https://linkaigo.com/autofill-test';
const evidence = process.env.QA_EVIDENCE_DIR;
const credentialsFile = process.env.QA_CREDENTIALS_FILE;
if (!evidence || !credentialsFile) throw new Error('Set QA_EVIDENCE_DIR and QA_CREDENTIALS_FILE (ignored local files)');
const credentials = JSON.parse(await readFile(credentialsFile, 'utf8'));
assert.match(credentials.email, /^remote-autofill-[a-f\d]+@example\.test$/);
await mkdir(evidence, { recursive: true });
const results = [];
let cookie = '';
let principal;
let initialProfile;
let initialContext;
let application;
let task;
const resources = [];
const runKey = `QA-20261018-${randomUUID().slice(0, 8)}`;

async function request(path, { method = 'GET', body, authenticated = true, headers = {}, target = base } = {}) {
  const started = performance.now();
  const response = await fetch(target + path, {
    method, headers: { 'content-type': 'application/json', ...(authenticated && cookie ? { cookie } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000), redirect: 'manual',
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  return { status: response.status, headers: response.headers, data, raw, ms: +(performance.now() - started).toFixed(1) };
}
const expectedStatus = (r, status) => assert.equal(r.status, status, `Expected HTTP ${status}, received ${r.status}`);
async function check(id, title, action) {
  const started = performance.now();
  try {
    const detail = await action();
    results.push({ id, title, status: 'pass', ms: +(performance.now() - started).toFixed(1), detail: detail || '' });
  } catch (error) {
    results.push({ id, title, status: 'fail', ms: +(performance.now() - started).toFixed(1), detail: String(error.message).slice(0, 600) });
  }
  console.log(`${results.at(-1).status.toUpperCase()} ${id} ${title}`);
}
const metadata = () => ({ protocolVersion: 'autofill.next.v2', requestId: runKey, runId: runKey, deadlineAt: Date.now() + 12_000 });
const profileInput = profile => Object.fromEntries(Object.entries(profile).filter(([key]) => !['id', 'userId', 'createdAt', 'updatedAt', 'deletedAt', 'extra', 'email'].includes(key)));

try {
  for (const [id, path, target] of [['ENV-01a', '/health', base], ['ENV-01b', '/api/health', 'https://linkaigo.com'], ['WEB-01a', '', web]]) {
    await check(id, `健康/页面 ${path || '/'}`, async () => {
      const r = await request(path, { target, authenticated: false });
      if (id === 'WEB-01a' && r.status === 302) assert.equal(r.headers.get('location'), '/autofill-test/workspace/autofill');
      else expectedStatus(r, 200);
      return `${r.ms}ms`;
    });
  }
  for (const [suffix, path, body] of [
    ['profile', '/profiles/me'], ['context', '/profiles/me/autofill-context'], ['applications', '/applications'],
    ['tasks', '/tasks'], ['calendar', '/calendar'], ['mail', '/mail-accounts'],
    ['readiness', '/autofill/v2/readiness', metadata()],
  ]) await check(`AUTH-03-${suffix}`, `未登录拦截 ${path}`, async () => expectedStatus(await request(path, { authenticated: false, ...(body ? { method: 'POST', body } : {}) }), 401));

  await check('AUTH-02a', '错误密码拒绝', async () => expectedStatus(await request('/auth/login', { method: 'POST', authenticated: false, body: { email: credentials.email, password: 'incorrect-qa-password' } }), 401));
  await check('AUTH-02b', '正确密码登录与 Cookie 安全属性', async () => {
    const r = await request('/auth/login', { method: 'POST', authenticated: false, body: { email: credentials.email, password: credentials.password } });
    expectedStatus(r, 200);
    const setCookie = r.headers.get('set-cookie');
    assert.match(setCookie, /^lingke_autofill_test=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/autofill-test']) assert.ok(setCookie.includes(flag));
    cookie = setCookie.split(';')[0];
  });
  if (!cookie) throw new Error('Login prerequisite failed');
  await check('AUTH-05a', '普通权限与 debug 能力关闭', async () => {
    const r = await request('/auth/me'); expectedStatus(r, 200); principal = r.data.user;
    assert.equal(principal.role, 'user'); assert.equal(principal.capabilities.extensionDebug, false);
  });
  await check('AUTH-02c', '拒绝主站 Cookie 冒用测试会话', async () => expectedStatus(await request('/auth/me', { authenticated: false, headers: { cookie: cookie.replace('lingke_autofill_test=', 'lingke_session=') } }), 401));
  await check('AUTH-05b', '填写账号绑定不一致拒绝', async () => expectedStatus(await request('/autofill/v2/readiness', { method: 'POST', body: metadata(), headers: { 'x-autofill-account-id': 'different-qa-account' } }), 401));

  // Reachability probes use intentionally invalid payloads and must never send
  // mail, register accounts, change credentials, or invoke a real model.
  for (const [id, path, body] of [
    ['AUTH-01a', '/auth/register', {}], ['AUTH-01b', '/auth/email-code', { email: '' }],
    ['AUTH-06a', '/auth/forgot-password', { email: '' }], ['AUTH-06b', '/auth/reset-password', {}],
    ['AUTH-06c', '/auth/verify-email', {}], ['AUTH-06d', '/auth/resend-verification', { email: '' }],
    ['IMP-01a', '/ai/resume/parse-file', {}], ['IMP-01b', '/ai/resume/parse', {}],
    ['IMP-02a', '/ai/resume/normalize', {}],
  ]) await check(id, `业务接口可达 ${path}`, async () => {
    const r = await request(path, { method: 'POST', body });
    assert.notEqual(r.status, 404, `公开页面依赖的 ${path} 返回 404`);
    assert.notEqual(r.status, 502, '代理返回 502');
    return `HTTP ${r.status}（无效输入探测，不代表功能完成）`;
  });

  await check('PRO-01a', '读取完整资料基线', async () => { const r = await request('/profiles/me'); expectedStatus(r, 200); initialProfile = r.data; assert.equal(r.data.profile.name, '林知夏'); });
  await check('PRO-04a', '简历导出契约与九类记录', async () => {
    const r = await request('/profiles/me/autofill-context'); expectedStatus(r, 200); initialContext = r.data;
    assert.equal(r.data.schemaVersion, 'resume.autofill.v1'); assert.match(r.data.profileVersion, /^[a-f\d]{64}$/);
    assert.equal(r.data.records.length, 18);
    assert.equal(new Set(r.data.records.map(record => record.recordType)).size, 9);
    for (const record of r.data.records) { assert.ok(record.id); assert.ok(Number.isInteger(record.index)); assert.ok(record.fields); }
    const forbidden = new Set(['userId', 'createdAt', 'updatedAt', 'deletedAt', 'homepage']);
    const inspect = obj => { if (!obj || typeof obj !== 'object') return; for (const [key, value] of Object.entries(obj)) { assert.ok(!forbidden.has(key), `Export leaked ${key}`); inspect(value); } };
    inspect(r.data);
    await writeFile(`${evidence}/context-baseline.json`, JSON.stringify(r.data, null, 2));
    return '18 records / 9 types; presentation/internal fields excluded';
  });
  await check('PRO-04b', '同内容导出版本稳定、下载头与内容一致', async () => {
    const r = await request('/profiles/me/export'); expectedStatus(r, 200);
    assert.match(r.headers.get('content-disposition'), /attachment.*autofill-context\.json/);
    assert.equal(r.data.profileVersion, initialContext.profileVersion); assert.deepEqual(r.data.records, initialContext.records);
  });
  await check('PRO-01b', '基本资料修改、读取和恢复', async () => {
    expectedStatus(await request('/profiles/me', { method: 'PATCH', body: { profile: { ...profileInput(initialProfile.profile), city: 'QA 测试城市' } } }), 200);
    assert.equal((await request('/profiles/me')).data.profile.city, 'QA 测试城市');
    assert.notEqual((await request('/profiles/me/autofill-context')).data.profileVersion, initialContext.profileVersion);
    expectedStatus(await request('/profiles/me', { method: 'PATCH', body: { profile: profileInput(initialProfile.profile) } }), 200);
    assert.equal((await request('/profiles/me/autofill-context')).data.profileVersion, initialContext.profileVersion);
  });
  await check('HOME-03', '主页展示修改不改变简历及版本', async () => {
    const input = { ...profileInput(initialProfile.profile), homepage: { ...initialProfile.profile.homepage, headline: 'QA 测试签名' } };
    expectedStatus(await request('/profiles/me', { method: 'PATCH', body: { profile: input } }), 200);
    assert.equal((await request('/profiles/me')).data.profile.homepage.headline, 'QA 测试签名');
    const context = (await request('/profiles/me/autofill-context')).data;
    assert.equal(context.profileVersion, initialContext.profileVersion); assert.deepEqual(context.records, initialContext.records);
    expectedStatus(await request('/profiles/me', { method: 'PATCH', body: { profile: profileInput(initialProfile.profile) } }), 200);
  });

  for (const [resource, body] of [
    ['educations', { school: runKey, degree: '本科' }], ['experiences', { company: runKey, title: '测试工程师' }],
    ['projects', { name: runKey }], ['skills', { name: runKey }],
  ]) await check(`PRO-02-${resource}`, `${resource} 新增/更新/软删/恢复`, async () => {
    const r = await request(`/profiles/me/${resource}`, { method: 'POST', body }); expectedStatus(r, 201);
    const id = r.data.item.id; resources.push({ resource, id });
    expectedStatus(await request(`/profiles/me/${resource}/${id}`, { method: 'PATCH', body: { ...body, qaMarker: runKey } }), 200);
    assert.ok((await request('/profiles/me')).data[resource].some(record => record.id === id));
    const deletion = await request(`/profiles/me/${resource}/${id}`, { method: 'DELETE' }); assert.ok([200, 204].includes(deletion.status));
    assert.ok(!(await request('/profiles/me')).data[resource].some(record => record.id === id));
    expectedStatus(await request(`/profiles/me/${resource}/${id}/restore`, { method: 'POST', body: {} }), 200);
    assert.ok((await request('/profiles/me')).data[resource].some(record => record.id === id));
    await request(`/profiles/me/${resource}/${id}`, { method: 'DELETE' });
  });
  await check('PRO-04c', '临时经历清理后原简历不变', async () => assert.equal((await request('/profiles/me/autofill-context')).data.profileVersion, initialContext.profileVersion));

  await check('APP-01a', '空公司拒绝', async () => expectedStatus(await request('/applications', { method: 'POST', body: { title: '测试职位' } }), 400));
  await check('APP-01b', '只填写公司可创建投递', async () => {
    const r = await request('/applications', { method: 'POST', body: { company: runKey, idempotencyKey: runKey } });
    expectedStatus(r, 201); application = r.data.application; assert.equal(application.title, ''); assert.equal(application.status, 'saved');
  });
  await check('APP-03a', '幂等重复创建不增加记录', async () => {
    const r = await request('/applications', { method: 'POST', body: { company: runKey, idempotencyKey: runKey } }); expectedStatus(r, 201); assert.equal(r.data.application.id, application.id);
  });
  await check('APP-02a', '搜索、详情与过滤', async () => {
    const r = await request(`/applications?q=${encodeURIComponent(runKey)}&status=saved`); expectedStatus(r, 200); assert.equal(r.data.items.length, 1);
    assert.equal(r.data.items[0].id, application.id);
    expectedStatus(await request(`/applications/${application.id}`), 200);
  });
  await check('APP-01c', '职位可补填并清空', async () => {
    for (const title of ['测试工程师', '']) {
      const r = await request(`/applications/${application.id}`, { method: 'PATCH', body: { version: application.version, title } }); expectedStatus(r, 200); application = r.data.application; assert.equal(application.title, title);
    }
  });
  await check('APP-03b', '过期版本更新拒绝', async () => expectedStatus(await request(`/applications/${application.id}`, { method: 'PATCH', body: { version: 0, title: 'stale' } }), 409));
  await check('APP-03c', '状态更新与非法状态校验', async () => {
    const r = await request(`/applications/${application.id}`, { method: 'PATCH', body: { version: application.version, status: 'interview' } }); expectedStatus(r, 200); application = r.data.application; assert.equal(application.status, 'interview');
    expectedStatus(await request(`/applications/${application.id}`, { method: 'PATCH', body: { version: application.version, status: 'invalid' } }), 400);
  });
  await check('APP-04a', '只填面试开始时间与日历', async () => {
    const eventStart = '2026-10-21T08:00:00.000Z';
    const r = await request(`/applications/${application.id}`, { method: 'PATCH', body: { version: application.version, eventStart, eventEnd: null } }); expectedStatus(r, 200); application = r.data.application; assert.equal(application.eventEnd, null);
    const calendar = await request('/calendar?from=2026-10-20&to=2026-10-22'); expectedStatus(calendar, 200);
    const item = calendar.data.items.find(item => item.type === 'application' && item.id === application.id); assert.ok(item); assert.equal(item.start, eventStart); assert.equal(item.end, null);
  });
  await check('APP-05a', '新增任务且幂等', async () => {
    const body = { title: runKey + ' 准备面试', dueAt: '2026-10-20T08:00:00.000Z', idempotencyKey: runKey };
    const r = await request(`/applications/${application.id}/tasks`, { method: 'POST', body }); expectedStatus(r, 201); task = r.data.task;
    assert.equal((await request(`/applications/${application.id}/tasks`, { method: 'POST', body })).data.task.id, task.id);
  });
  await check('APP-05b', '任务完成与重开', async () => {
    for (const status of ['done', 'open']) { const r = await request(`/tasks/${task.id}`, { method: 'PATCH', body: { status } }); expectedStatus(r, 200); assert.equal(r.data.task.status, status); }
    assert.ok((await request(`/applications/${application.id}/tasks`)).data.items.some(item => item.id === task.id));
  });
  await check('APP-05c', '非法任务状态应拒绝', async () => {
    const r = await request(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'not-a-real-state' } });
    if (r.status === 200) await request(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'open' } });
    expectedStatus(r, 400);
  });
  await check('APP-02b', '分页游标与非法游标', async () => {
    const first = await request('/applications?limit=1'); expectedStatus(first, 200); assert.equal(first.data.items.length, 1);
    if (first.data.nextCursor) { const next = await request('/applications?limit=1&cursor=' + encodeURIComponent(first.data.nextCursor)); expectedStatus(next, 200); assert.notEqual(first.data.items[0].id, next.data.items[0]?.id); }
    expectedStatus(await request('/applications?cursor=invalid'), 400);
  });
  await check('APP-03d', '填写完成事件不冒充已投递且去重', async () => {
    const created = await request('/applications', { method: 'POST', body: { company: runKey + '-event', source: 'extension', idempotencyKey: runKey + '-event' } }); expectedStatus(created, 201);
    const id = created.data.application.id;
    const body = { type: 'fill.completed', clientEventId: runKey + '-event', source: 'extension' };
    for (let n = 0; n < 2; n++) { const r = await request(`/applications/${id}/events`, { method: 'POST', body }); expectedStatus(r, 201); assert.equal(r.data.application.status, 'saved'); }
    assert.equal((await request(`/applications/${id}`)).data.application.events.length, 1);
  });

  for (const [suffix, path] of [['providers', '/mail/providers'], ['accounts', '/mail-accounts'], ['messages', '/mail-messages']]) await check(`MAIL-01-${suffix}`, `邮件入口 ${path}`, async () => { const r = await request(path); expectedStatus(r, 200); return '接口可达；不代表真实收信已验证'; });
  await check('EXT-03a', '填写 readiness 含当前资料', async () => { const r = await request('/autofill/v2/readiness', { method: 'POST', body: metadata() }); expectedStatus(r, 200); assert.equal(r.data.ok, true); await writeFile(`${evidence}/readiness.json`, JSON.stringify(r.data, null, 2)); return `${r.ms}ms`; });
  await check('EXT-03b', '填写协议无效拒绝', async () => expectedStatus(await request('/autofill/v2/readiness', { method: 'POST', body: { ...metadata(), protocolVersion: 'invalid' } }), 400));
  await check('EXT-03c', '填写超时拒绝', async () => expectedStatus(await request('/autofill/v2/readiness', { method: 'POST', body: { ...metadata(), deadlineAt: Date.now() - 1 } }), 504));
  await check('EXT-03d', '拒绝未授权来源', async () => expectedStatus(await request('/autofill/v2/readiness', { method: 'POST', body: metadata(), headers: { origin: 'https://untrusted.example' } }), 403));
  await check('EXT-03e', '下载扩展 CORS 允许', async () => {
    const origin = 'chrome-extension://jmfbkpdfefifliffkdkmljihmkeapjkb';
    const r = await request('/autofill/v2/readiness', { method: 'POST', body: metadata(), headers: { origin } }); expectedStatus(r, 200); assert.equal(r.headers.get('access-control-allow-origin'), origin); assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
  });
  await check('AUTH-05c', '普通用户规则维护不可写', async () => { const r = await request('/autofill/rules/drafts', { method: 'POST', body: {} }); assert.ok([403, 404].includes(r.status), `Expected denied/not-exposed route, received ${r.status}`); });
  await check('AUTH-04a', '退出与旧 Cookie 失效', async () => { expectedStatus(await request('/auth/logout', { method: 'POST', body: {} }), 200); expectedStatus(await request('/auth/me'), 401); cookie = ''; });
} finally {
  // Restore the designated account's pre-test profile, and soft-delete only
  // records created by this runner. Application fixtures stay clearly marked.
  if (cookie) {
    if (initialProfile) await request('/profiles/me', { method: 'PATCH', body: { profile: profileInput(initialProfile.profile) } }).catch(() => {});
    for (const { resource, id } of resources) await request(`/profiles/me/${resource}/${id}`, { method: 'DELETE' }).catch(() => {});
    if (task) await request(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'open' } }).catch(() => {});
    await request('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  }
  const summary = { generatedAt: new Date().toISOString(), base, codeBaseline: 'b26bae5', runKey, totals: { pass: results.filter(r => r.status === 'pass').length, fail: results.filter(r => r.status === 'fail').length }, applicationId: application?.id, taskId: task?.id, results };
  await writeFile(`${evidence}/http-results.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary.totals));
  process.exitCode = summary.totals.fail ? 1 : 0;
}
