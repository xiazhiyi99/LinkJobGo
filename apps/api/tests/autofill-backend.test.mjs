import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { createProfileStore, userA, userB } from './fixtures/profile-store.mjs';
const require = createRequire(import.meta.url);
const { createProfileService } = require('../src/profile/service');
const { createAiGateway } = require('../src/ai/gateway');
const { createHttpProvider } = require('../src/ai/providers/http-provider');
const { createAutofillModule } = require('../src/modules/autofill');
const { createConfiguredSiteRegistry, createSiteRegistry, createMappingService, createAiResolver } = require('../src/modules/autofill/dist/engine.cjs');
const { createPlatformResumeClient } = require('../src/modules/autofill/adapters/resume-client');
const { createGatewayAiProvider } = require('../src/modules/autofill/adapters/ai-provider');
const { createAutofillHandler } = require('../src/modules/autofill/routes');
const { ServiceError } = require('../src/modules/autofill/errors');
const { createRequestAuthenticator, AuthenticationError } = require('../src/auth/request-user');
const { PROTOCOL_VERSION, FIELD_CATALOG, validateFillPlan } = require('@job-assistant/autofill-contracts');
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
const stop = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
const metadata = extra => ({ protocolVersion: PROTOCOL_VERSION, requestId: 'request-test', runId: 'run-test', deadlineAt: Date.now() + 5000, ...extra });
const section = (id, label, fields, repeatable = false) => ({ sectionId: id, label, mode: 'inline', repeatable, records: [{ viewId: `${id}-view`, fields: fields.map(([label, kind = 'text'], index) => ({ fieldId: `${id}-${index}`, label, kind, required: false, currentState: 'empty', hints: {} })) }], actions: [] });
const snapshot = (page = { origin: 'https://zhaopin.meituan.com', path: '/web/delivery-confirm' }) => ({ protocolVersion: PROTOCOL_VERSION, documentId: 'doc-test', pageRevision: 1, page: { title: 'Synthetic application', ...page }, sections: [section('basic', '基本信息', [['姓名'], ['Mystery']]), section('education', '教育经历', [['学校'], ['学历', 'combobox']], true)] });
const evidence = (snap, recordId, options) => ({ documentId: snap.documentId, pageRevision: snap.pageRevision, probeId: `probe-${recordId}`, sectionId: 'education', viewId: recordId === 'education-new' ? 'education-second' : 'education-view', templateFieldId: 'education-1', recordId, options, status: 'ready' });

function addEducationView(snap, semanticPage) {
  const record = structuredClone(snap.sections[1].records[0]);
  record.viewId = 'education-second';
  record.fields.forEach(field => { field.fieldId += '-second'; });
  snap.sections[1].records.push(record);
  snap.pageRevision += 1;
  semanticPage.pageRevision = snap.pageRevision;
}

async function harness(run, model = () => ({ bindings: [] }), configure = {}) {
  const calls = [], attempts = [];
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString()); calls.push(payload);
    const output = await model(payload, req, res);
    if (output !== undefined && !res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  });
  const upstreamUrl = await listen(upstream);
  const store = createProfileStore();
  const profileService = createProfileService({ prisma: store.prisma });
  const gateway = createAiGateway({ providerFactory: () => createHttpProvider({ tier: 'official', baseUrl: upstreamUrl, apiKey: 'synthetic-only', model: 'controlled-upstream' }), onAttempt: event => attempts.push(event), sleepFn: async () => {} });
  const authenticate = async req => req.headers.authorization === 'Bearer user-a' ? userA : req.headers.authorization === 'Bearer user-b' ? userB : null;
  const module = createAutofillModule({ profileService, aiGateway: gateway, authenticate, config: { mokaMode: 'enabled', allowedOrigins: ['chrome-extension://test-extension'], ...configure } });
  const server = createServer((req, res) => module.handle(req, res, new URL(req.url, 'http://local').pathname));
  const base = await listen(server);
  const post = async (route, body = {}, options = {}) => {
    const response = await fetch(base + '/autofill/v2/' + route, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer user-a', ...options.headers }, body: options.raw ?? JSON.stringify(metadata(body)), signal: options.signal });
    return { status: response.status, headers: response.headers, ...(await response.json()) };
  };
  try { await run({ post, module, calls, attempts, store, profileService, gateway, base }); }
  finally { await stop(server); await stop(upstream); }
}

test('known-site readiness, partial mapping, repeated plans and ambiguous options never call the model', async () => {
  await harness(async ({ post, calls, profileService }) => {
    const ready = await post('readiness');
    assert.deepEqual(Object.keys(ready.data), ['profileVersion']);
    assert.equal(ready.headers.get('cache-control'), 'no-store');
    const snap = snapshot();
    const analyzed = await post('analyze', { snapshot: snap });
    assert.equal(analyzed.status, 200);
    assert.equal(analyzed.data.sections[0].bindings[0].resolvedBy, 'site');
    assert.equal(analyzed.data.sections[0].bindings[1].status, 'unresolved');
    const input = { snapshot: snap, semanticPage: analyzed.data, scope: { sectionIds: ['basic', 'education'] }, optionEvidence: [], expectedProfileVersion: ready.data.profileVersion };
    const first = await post('plan', input);
    assert.equal(first.status, 200, JSON.stringify(first));
    assert.equal(first.data.sections[1].records.length, 2, 'records come from the source, not the one DOM template');
    assert.equal(first.data.sections[1].records[0].assignments[1].status, 'needs-options');
    const options = [{ optionId: 'bachelor', label: '本科', disabled: false }, { optionId: 'masters', label: '硕士', disabled: false }];
    addEducationView(snap, input.semanticPage);
    input.optionEvidence = first.data.sections[1].records.map(record => evidence(snap, record.recordId, options));
    const planned = await post('plan', input);
    assert.equal(planned.status, 200, JSON.stringify(planned));
    assert.equal(planned.data.sections[1].records[0].assignments[1].value, 'bachelor');
    assert.equal(planned.data.sections[1].records[1].assignments[1].value, 'masters');
    assert.equal(validateFillPlan(planned.data, { snapshot: snap, semanticPage: analyzed.data, catalog: FIELD_CATALOG, resumeContext: await profileService.getAutofillContext(userA) }).ok, true);
    input.semanticPage.sections[0].bindings[0] = { templateFieldId: 'basic-0', sourceKey: { scope: 'profile', path: ['email'] }, status: 'resolved', resolvedBy: 'ai' };
    input.optionEvidence[0].options.push({ optionId: 'ambiguous', label: '本科', disabled: false });
    const rerun = await post('plan', input);
    assert.equal(rerun.status, 200, JSON.stringify(rerun));
    assert.equal(rerun.data.sections[0].records[0].assignments[0].value, '合成候选人甲', 'server re-derives known bindings');
    assert.equal(rerun.data.sections[1].records[0].assignments[1].status, 'unresolved');
    for (const page of [{ origin: 'https://careers.tencent.com', path: '/resume.html' }, { origin: 'https://campus-talent.alibaba.com', path: '/personal/resume' }, { origin: 'https://zhaopin.meituan.com', path: '/unobserved' }]) {
      const snap = snapshot(page), analyzed = await post('analyze', { snapshot: snap });
      assert.equal(analyzed.status, 200);
      assert.equal((await post('plan', { snapshot: snap, semanticPage: analyzed.data, scope: { sectionIds: ['basic'] }, optionEvidence: [] })).status, 200);
    }
    for (const [path, hashRoute] of [['/campus_apply/baai/42174', '/job/13706229-ac4f-4d58-9a8a-f0f43a05730a/apply'], ['/campus_apply/zuoyebang/144908', '/job/6e0a630d-9d1b-4855-b0c2-a916adf971d3/apply']]) {
      const snap = snapshot({ origin: 'https://app.mokahr.com', path, hashRoute });
      snap.sections = [section('basic', '个人信息', [['姓名']])];
      const semanticPage = (await post('analyze', { snapshot: snap })).data;
      const plan = await post('plan', { snapshot: snap, semanticPage, optionEvidence: [], scope: { sectionIds: ['basic'] } });
      assert.equal(plan.status, 200, JSON.stringify(plan));
      assert.equal(plan.data.sections[0].records[0].assignments[0].value, '合成候选人甲');
    }
    assert.equal(calls.length, 0);
  });
});

test('Moka registry keeps exact observed hash routes and does not enable drafts', () => {
  const registry = createConfiguredSiteRegistry({ mokaMode: 'enabled' });
  for (const [path, hashRoute] of [['/campus_apply/baai/42174', '/job/13706229-ac4f-4d58-9a8a-f0f43a05730a/apply'], ['/campus_apply/zuoyebang/144908', '/job/6e0a630d-9d1b-4855-b0c2-a916adf971d3/apply']]) {
    const snap = snapshot({ origin: 'https://app.mokahr.com', path, hashRoute });
    assert.equal(registry.classify(snap).parser.id, 'moka');
    assert.equal(createConfiguredSiteRegistry().classify(snap).kind, 'unknown');
    snap.page.hashRoute = '/jobs'; assert.equal(registry.classify(snap).kind, 'unknown');
  }
  for (const origin of ['https://jobs.lever.co', 'https://job-boards.greenhouse.io', 'https://zhaopin.meituan.com.example.test']) assert.equal(registry.classify(snapshot({ origin, path: '/' })).kind, 'unknown');
  assert.throws(() => createConfiguredSiteRegistry({ mokaMode: 'true' }));
});

test('Moka internship plans retain source IDs and indices after filtering full-time records', async () => {
  await harness(async ({ post, store, calls, profileService }) => {
    const base = store.rows.experience[0]; base.extra.employmentType = '正式';
    store.rows.experience.push(
      { ...structuredClone(base), id: 'fulltime-second', createdAt: '2026-03-01T00:00:00.000Z' },
      { ...structuredClone(base), id: 'internship-third', createdAt: '2026-04-01T00:00:00.000Z', extra: { employmentType: '实习' } },
      { ...structuredClone(base), id: 'unknown-fourth', createdAt: '2026-05-01T00:00:00.000Z', extra: {} },
    );
    const snap = snapshot({ origin: 'https://app.mokahr.com', path: '/campus_apply/zuoyebang/144908', hashRoute: '/job/6e0a630d-9d1b-4855-b0c2-a916adf971d3/apply' });
    snap.sections = [section('internships', '实习经历', [['公司名称'], ['职位名称'], ['工作职责', 'textarea']], true)];
    const analyzed = await post('analyze', { snapshot: snap }); assert.equal(analyzed.status, 200);
    const plan = await post('plan', { snapshot: snap, semanticPage: analyzed.data, optionEvidence: [], scope: { sectionIds: ['internships'] } });
    assert.equal(plan.status, 200, JSON.stringify(plan));
    assert.deepEqual(plan.data.sections[0].records.map(r => [r.recordId, r.recordIndex, r.targetIndex]), [['internship-third', 2, 0]]);
    assert.ok(plan.data.sections[0].records[0].assignments.every(a => a.sourceRef.recordId === 'internship-third'));
    assert.equal(validateFillPlan(plan.data, { snapshot: snap, semanticPage: analyzed.data, catalog: FIELD_CATALOG, resumeContext: await profileService.getAutofillContext(userA) }).ok, true);
    assert.equal(calls.length, 0);
  });
});

test('unknown-site mapping/options traverse the unified HTTP provider and accept only catalog/candidate IDs', async () => {
  await harness(async ({ post, calls, attempts }) => {
    const snap = snapshot({ origin: 'https://new.example.test', path: '/apply' });
    const mapped = await post('analyze', { snapshot: snap });
    assert.equal(mapped.status, 200);
    assert.equal(mapped.data.sections[0].bindings[0].resolvedBy, 'ai');
    assert.equal(mapped.data.sections[0].bindings[1].status, 'unresolved', 'invented candidates rejected');
    const input = { snapshot: snap, semanticPage: mapped.data, scope: { sectionIds: ['basic', 'education'] }, optionEvidence: [] };
    const first = await post('plan', input);
    assert.equal(first.status, 200);
    addEducationView(snap, input.semanticPage);
    input.optionEvidence = first.data.sections[1].records.map(record => evidence(snap, record.recordId, [{ optionId: 'real-option', label: 'Equivalent upstream choice', disabled: false }, { optionId: 'disabled', label: 'Forbidden', disabled: true }]));
    const planned = await post('plan', input);
    assert.equal(planned.status, 200, JSON.stringify(planned));
    assert.equal(planned.data.sections[1].records[0].assignments[1].value, 'real-option');
    assert.equal(planned.data.sections[1].records[1].assignments[1].status, 'unresolved', 'outside options cannot become ready');
    assert.equal(calls.length, 3);
    assert.deepEqual(attempts.map(a => a.task), ['autofill.map-fields', 'autofill.match-options', 'autofill.match-options']);
    assert.ok(attempts.every(a => a.requestId === 'request-test' && a.runId === 'run-test'));
    const mapping = JSON.parse(calls[0].messages[1].content);
    assert.deepEqual(Object.keys(mapping).sort(), ['candidates', 'sections']);
    assert.ok(!JSON.stringify(calls).includes(userA.email));
    assert.ok(!JSON.stringify(calls).includes('合成候选人甲'));
    assert.equal(JSON.parse(calls[1].messages[1].content).candidates.length, 1);
  }, payload => {
    const input = JSON.parse(payload.messages[1].content);
    if (input.candidates?.[0]?.candidateId) {
      const key = (scope, name, recordType) => input.candidates.find(c => c.sourceKey.scope === scope && c.sourceKey.path.at(-1) === name && (!recordType || c.sourceKey.recordType === recordType)).candidateId;
      return { bindings: [{ sectionId: 'basic', templateFieldId: 'basic-0', candidateId: key('profile', 'name') }, { sectionId: 'basic', templateFieldId: 'basic-1', candidateId: 'c999999' }, { sectionId: 'education', templateFieldId: 'education-0', candidateId: key('record', 'school', 'education') }, { sectionId: 'education', templateFieldId: 'education-1', candidateId: key('record', 'degree', 'education') }] };
    }
    return { optionIds: [input.sourceValue === '本科' ? 'real-option' : 'invented-option'] };
  });
});

test('HTTP boundaries authenticate before data, enforce protocol/limits and sanitize failures', async () => {
  await harness(async ({ post, calls, store }) => {
    assert.equal((await post('readiness', {}, { headers: { authorization: '' }, raw: '{' })).status, 401);
    assert.equal(store.calls.length, 0);
    assert.equal((await post('readiness', {}, { headers: { origin: 'https://untrusted.test' } })).status, 403);
    const allowed = await post('readiness', {}, { headers: { origin: 'chrome-extension://test-extension' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'chrome-extension://test-extension');
    for (const extra of [{ profile: {} }, { userId: userB.id }, { aiPhase: 'mapping' }, { snapshot: {} }, { protocolVersion: 'old' }, { requestId: 'x'.repeat(129) }]) assert.equal((await post('readiness', extra)).status, 400);
    assert.equal((await post('readiness', {}, { raw: '{' })).error.code, 'invalid-json');
    assert.equal((await post('readiness', {}, { headers: { 'content-type': 'text/plain' } })).status, 400);
    assert.equal((await post('analyze', {}, { raw: JSON.stringify({ junk: 'x'.repeat(512 * 1024) }) })).status, 413);
    assert.equal((await post('readiness', { deadlineAt: Date.now() - 1 })).status, 504);
    assert.equal((await post('readiness', { deadlineAt: null })).status, 400);
    assert.equal((await post('absent')).status, 404);
    const readiness = await post('readiness');
    const snap = snapshot(), semanticPage = (await post('analyze', { snapshot: snap })).data;
    store.rows.profile[0].name = '合成修改';
    const input = { snapshot: snap, semanticPage, optionEvidence: [], scope: { sectionIds: ['basic'] }, expectedProfileVersion: readiness.data.profileVersion };
    assert.equal((await post('plan', input)).status, 409);
    assert.equal((await post('plan', { ...input, expectedProfileVersion: 'invalid' })).status, 400);
    store.prisma.profile.findUnique = async () => { throw new Error('secret database details'); };
    const failure = await post('readiness');
    assert.equal(failure.status, 502);
    assert.ok(!JSON.stringify(failure).includes('secret'));
    assert.equal(calls.length, 0);
  });
});

test('known parser failures, option exceptions and route conflicts cannot enter AI', async () => {
  await harness(async ({ profileService, gateway, calls }) => {
    const parser = createConfiguredSiteRegistry().classify(snapshot()).parser;
    const ctx = { principal: userA, requestId: 'rule-error', deadlineAt: Date.now() + 5000 };
    const build = parsers => createMappingService({ resumeClient: createPlatformResumeClient({ profileService }), siteRegistry: createSiteRegistry(parsers), aiResolver: createAiResolver({ provider: createGatewayAiProvider({ aiGateway: gateway }) }), catalog: FIELD_CATALOG });
    const broken = build([{ ...parser, parse() { throw new Error('private'); } }]);
    await assert.rejects(broken.analyzePage(metadata({ snapshot: snapshot() }), ctx), e => e instanceof ServiceError && e.code === 'site-parser-failed');
    const conflicted = build([parser, { ...parser, id: 'conflict' }]);
    await assert.rejects(conflicted.analyzePage(metadata({ snapshot: snapshot() }), ctx), e => e.code === 'site-classification-failed');
    const service = build([{ ...parser, resolveOption() { throw new Error('private option failure'); } }]);
    const snap = snapshot(), semanticPage = await service.analyzePage(metadata({ snapshot: snap }), ctx);
    const plan = await service.buildFillPlan(metadata({ snapshot: snap, semanticPage, scope: { sectionIds: ['education'] }, optionEvidence: [evidence(snap, 'education-old', [{ optionId: 'one', label: '本科', disabled: false }])] }), ctx);
    assert.equal(plan.sections[0].records[0].assignments[1].status, 'unresolved');
    assert.equal(calls.length, 0);
  });
});

test('client disconnect and absolute deadline abort the real upstream without retrying', async () => {
  let seen, closed;
  const started = () => new Promise(resolve => { seen = resolve; });
  const stopped = () => new Promise(resolve => { closed = resolve; });
  await harness(async ({ post, calls, base }) => {
    const snap = snapshot({ origin: 'https://slow.example.test', path: '/apply' });
    let arrival = started(), upstreamClosed = stopped();
    const controller = new AbortController();
    const request = post('analyze', { snapshot: snap }, { signal: controller.signal });
    const rejected = assert.rejects(request, error => error.name === 'AbortError');
    await arrival; controller.abort(); await rejected; await upstreamClosed;
    assert.equal(calls.length, 1);
    arrival = started(); upstreamClosed = stopped();
    const timed = post('analyze', { snapshot: snap, deadlineAt: Date.now() + 100 });
    await arrival; assert.equal((await timed).status, 504); await upstreamClosed;
    assert.equal(calls.length, 2);
    // Chunked over-limit upload must still receive a 413 envelope, not reset.
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest(base + '/autofill/v2/analyze', { method: 'POST', headers: { authorization: 'Bearer user-a', 'content-type': 'application/json' } }, res => { let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) })); });
      req.on('error', reject); req.write('{"oversize":"'); req.write('x'.repeat(520 * 1024)); req.end('"}');
    });
    assert.equal(result.status, 413); assert.equal(result.body.ok, false);
  }, (_payload, _req, res) => { res.on('close', () => closed()); seen(); return undefined; });
});

test('authentication policy and error envelopes stay separate from the filling core', async () => {
  let account = null, available = true;
  const authenticate = createRequestAuthenticator({ currentUser: async () => account, databaseAvailable: () => available, verificationRequired: () => true });
  await assert.rejects(authenticate({}), e => e instanceof AuthenticationError && e.status === 401);
  account = userA;
  await assert.rejects(authenticate({}), e => e.status === 403 && e.code === 'EMAIL_NOT_VERIFIED');
  account = { ...userA, emailVerifiedAt: new Date() };
  assert.deepEqual(await authenticate({}), account);
  available = false;
  await assert.rejects(authenticate({}), e => e.status === 503);
  // Authentication and body receipt consume the server's maximum budget too.
  const handler = createAutofillHandler({ service: {}, authenticate: () => new Promise(() => {}), maxTimeoutMs: 30 });
  const server = createServer((req, res) => handler(req, res, '/autofill/v2/readiness'));
  const base = await listen(server);
  try {
    const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(metadata()) });
    assert.equal(response.status, 504); assert.equal((await response.json()).error.code, 'deadline-exceeded');
  } finally { await stop(server); }
});


test('account binding cannot select another user or accept a switched Cookie principal', async () => {
  await harness(async ({ post }) => {
    assert.equal((await post('readiness', {}, { headers: { 'x-autofill-account-id': userA.id } })).status, 200);
    assert.equal((await post('readiness', {}, { headers: { 'x-autofill-account-id': userB.id } })).status, 401);
    assert.equal((await post('readiness', {}, { headers: { authorization: 'Bearer user-b', 'x-autofill-account-id': userA.id } })).status, 401);
  });
});
