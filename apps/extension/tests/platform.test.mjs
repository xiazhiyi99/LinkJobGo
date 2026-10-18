import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { buildConfiguration } from '../scripts/build.mjs';
const bundled = await build({ stdin: { contents: "export * from './src/platform/auth.ts'; export * from './src/platform/token-store.ts'; export * from './src/platform/api-client.ts'; export * from './src/shell/background.ts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node', define: { __PLATFORM_API_ORIGIN__: '"http://127.0.0.1:3001"', __PLATFORM_API_PATH_PREFIX__: '""', __PLATFORM_DEVELOPMENT__: 'true' } });
const { createAuthService, createTokenStore, createApiClient, createBackground, PlatformError } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const account = { id: 'synthetic-user', email: 'synthetic@example.test', emailVerified: true };
const session = (origin = 'http://127.0.0.1:3001') => ({ apiOrigin: origin, accessToken: 'synthetic-access-only', expiresAt: Date.now() + 60000, user: account });
const metadata = extra => ({ protocolVersion: 'autofill.next.v2', requestId: crypto.randomUUID(), runId: crypto.randomUUID(), deadlineAt: Date.now() + 2000, ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
function storageBoundary() {
  let saved = {}, restricted = false;
  return { dump: () => structuredClone(saved), port: {
    async setAccessLevel(options) { assert.deepEqual(options, { accessLevel: 'TRUSTED_CONTEXTS' }); restricted = true; },
    async get(key) { assert.ok(restricted); return structuredClone(saved); },
    async set(value) { assert.ok(restricted); saved = structuredClone(value); },
  } };
}
async function upstream(run) {
  const received = [];
  let respond = (_req, input) => ({ status: 200, body: { ok: true, requestId: input.requestId, data: { profileVersion: 'a'.repeat(64) } } });
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString()); received.push({ path: req.url, input, authorization: req.headers.authorization });
    const result = await respond(req, input, res);
    if (result) { res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await run({ origin, api: createApiClient({ apiOrigin: origin }), received, respond: handler => { respond = handler; } }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('deployment origins are fixed, HTTPS in production and loopback-only for local HTTP', () => {
  assert.equal(buildConfiguration({}).apiOrigin, 'http://127.0.0.1:3001');
  assert.deepEqual(buildConfiguration({ EXTENSION_MODE: 'production', EXTENSION_API_ORIGIN: 'https://platform.example.test' }), { apiOrigin: 'https://platform.example.test', apiPathPrefix: '', development: false });
  for (const origin of ['http://platform.example.test', 'https://user:secret@platform.example.test', 'https://platform.example.test/path', 'https://platform.example.test/?token=x']) assert.throws(() => buildConfiguration({ EXTENSION_MODE: 'production', EXTENSION_API_ORIGIN: origin }));
  assert.throws(() => buildConfiguration({ EXTENSION_MODE: 'production' }));
});

test('trusted storage retains expired credentials, limits writes by revision and supports explicit clearing', async () => {
  const boundary = storageBoundary(), store = createTokenStore(boundary.port);
  const previous = await store.read(); await store.update(previous.revision, { ...session(), expiresAt: Date.now() - 1 });
  const saved = await store.read();
  assert.equal(saved.session.accessToken, 'synthetic-access-only');
  assert.equal(await store.update(previous.revision, session()), false);
  assert.equal((await store.read()).revision, saved.revision);
  await store.clear(); assert.equal((await store.read()).session, undefined);
});

test('API prefixes are normalized and cannot escape the configured deployment', () => {
  for (const [input, expected] of [['', ''], ['/', ''], ['/api/', '/api'], ['/autofill-test/api', '/autofill-test/api']]) {
    assert.equal(buildConfiguration({ EXTENSION_API_PATH_PREFIX: input }).apiPathPrefix, expected);
    assert.doesNotThrow(() => createApiClient({ apiOrigin: 'https://example.test', apiPathPrefix: input }));
  }
  for (const prefix of ['api', '//other.test', '/api//', '/api/../private', '/api/%2e%2e', '/api?x=1', '/api#x', '/api\\private']) {
    assert.throws(() => buildConfiguration({ EXTENSION_API_PATH_PREFIX: prefix }));
    assert.throws(() => createApiClient({ apiOrigin: 'https://example.test', apiPathPrefix: prefix }));
  }
});

test('prefixed login, database readiness, analyze, plan and logout reach the same service; tokens cannot cross prefixes', async () => {
  await upstream(async ({ origin, received, respond }) => {
    const apiPathPrefix = '/autofill-test/api';
    const api = createApiClient({ apiOrigin: origin, apiPathPrefix });
    const store = createTokenStore(storageBoundary().port);
    const auth = createAuthService({ apiOrigin: origin, apiPathPrefix, api, store });
    respond((req, input) => ({ status: 200, body: req.url.endsWith('/login')
      ? { accessToken: 'synthetic-access', expiresIn: 900, user: account }
      : req.url.endsWith('/logout') ? { ok: true } : { ok: true, requestId: input.requestId, data: {} } }));
    await auth.login(account.email, 'synthetic-password');
    assert.equal((await auth.status()).backendUrl, origin + apiPathPrefix);
    for (const operation of ['readiness', 'analyze', 'plan']) await auth.fill(operation, metadata(), { deadlineAt: Date.now() + 2000 });
    await auth.logout();
    assert.deepEqual(received.map(r => r.path), ['/auth/extension/login', '/autofill/v2/readiness', '/autofill/v2/analyze', '/autofill/v2/plan', '/auth/extension/logout'].map(path => apiPathPrefix + path));
    for (const oldPrefix of [undefined, '/api']) {
      const before = await store.read();
      await store.update(before.revision, { ...session(origin), apiPathPrefix: oldPrefix });
      assert.equal((await auth.status()).state, 'needs-login');
      assert.equal((await auth.status()).email, undefined);
      await assert.rejects(auth.fill('readiness', metadata(), { deadlineAt: Date.now() + 1000 }), e => e.code === 'authentication-required');
      assert.equal((await auth.logout()).serverRevoked, false);
      assert.equal(received.length, 5);
    }
  });
});

test('login and explicit logout use the platform endpoints without exposing passwords or tokens in status', async () => {
  await upstream(async ({ origin, api, received, respond }) => {
    respond(req => req.url.endsWith('/login') ? { status: 200, body: { accessToken: 'synthetic-access', refreshToken: 'unused-refresh', expiresIn: 900, user: { ...account, ignored: 'not stored' } } } : { status: 200, body: { ok: true } });
    const boundary = storageBoundary(), store = createTokenStore(boundary.port);
    const auth = createAuthService({ apiOrigin: origin, api, store });
    await auth.login(account.email, 'synthetic-password');
    const status = await auth.status();
    assert.equal(status.state, 'authenticated');
    assert.ok(!JSON.stringify(status).includes('accessToken'));
    assert.ok(!JSON.stringify(boundary.dump()).includes('synthetic-password'));
    assert.ok(!JSON.stringify(boundary.dump()).includes('unused-refresh'));
    assert.ok(!JSON.stringify(boundary.dump()).includes('ignored'));
    assert.equal((await auth.logout()).serverRevoked, true);
    assert.equal((await auth.status()).state, 'signed-out');
    assert.deepEqual(received.map(r => r.path), ['/auth/extension/login', '/auth/extension/logout']);
    assert.equal(received[1].authorization, 'Bearer synthetic-access');
  });
});

test('401 requires re-login without deleting tokens; network failure and 403 preserve status and never refresh/replay', async () => {
  await upstream(async ({ origin, api, received, respond }) => {
    const boundary = storageBoundary(), store = createTokenStore(boundary.port);
    const auth = createAuthService({ apiOrigin: origin, api, store });
    for (const status of [503, 403, 401]) {
      const current = await store.read(); await store.update(current.revision, session(origin));
      respond(() => ({ status, body: { error: 'sensitive upstream text' } }));
      await assert.rejects(auth.fill('readiness', metadata(), { deadlineAt: Date.now() + 1000 }), e => e instanceof PlatformError && !e.message.includes('sensitive'));
      assert.equal((await auth.status()).state, status === 401 ? 'needs-login' : 'authenticated');
      assert.equal((await store.read()).session.accessToken, 'synthetic-access-only');
    }
    assert.equal(received.length, 3); assert.ok(received.every(r => r.path === '/autofill/v2/readiness'));
    const current = await store.read(); await store.update(current.revision, { ...session(origin), expiresAt: Date.now() - 1 });
    await assert.rejects(auth.fill('readiness', metadata(), { deadlineAt: Date.now() + 1000 }), e => e.code === 'authentication-required');
    assert.equal(received.length, 3);
  });
});

test('logout racing a login discards its late result and changing API origin never forwards old credentials', async () => {
  await upstream(async ({ origin, api, received, respond }) => {
    const arrival = deferred(), release = deferred();
    respond(async req => { arrival.resolve(); await release.promise; return { status: 200, body: { accessToken: 'late-token', expiresIn: 900, user: account } }; });
    const boundary = storageBoundary(), store = createTokenStore(boundary.port), auth = createAuthService({ apiOrigin: origin, api, store });
    const pending = auth.login(account.email, 'synthetic-password');
    const rejected = assert.rejects(pending, e => e.code === 'cancelled');
    await arrival.promise; await auth.logout(); release.resolve(); await rejected;
    assert.equal((await store.read()).session, undefined);
    const before = await store.read(); await store.update(before.revision, session('https://old-platform.example.test'));
    await assert.rejects(auth.fill('readiness', metadata(), { deadlineAt: Date.now() + 1000 }), e => e.code === 'authentication-required');
    assert.equal(received.length, 1);
  });
});

test('new transport routes correlate responses and cancel real HTTP work within the original budget', async () => {
  await upstream(async ({ api, received, respond }) => {
    const input = metadata();
    for (const operation of ['readiness', 'analyze', 'plan']) assert.equal((await api.fill(operation, input, 'synthetic', { deadlineAt: input.deadlineAt })).ok, true);
    assert.deepEqual(received.map(r => r.path), ['/autofill/v2/readiness', '/autofill/v2/analyze', '/autofill/v2/plan']);
    respond(() => ({ status: 200, body: { ok: true, requestId: 'mismatched', data: {} } }));
    await assert.rejects(api.fill('plan', input, 'synthetic', { deadlineAt: input.deadlineAt }), e => e.code === 'backend-invalid-response');
    respond(() => ({ status: 200, body: 'x'.repeat(1024 * 1024 + 1) }));
    await assert.rejects(api.fill('plan', input, 'synthetic', { deadlineAt: input.deadlineAt }), e => e.code === 'backend-response-too-large');
    const arrived = deferred(), closed = deferred();
    respond((_req, _input, res) => { res.once('close', closed.resolve); arrived.resolve(); });
    const controller = new AbortController();
    const pending = api.fill('plan', input, 'synthetic', { deadlineAt: Date.now() + 1000, signal: controller.signal });
    const rejected = assert.rejects(pending, e => e.code === 'cancelled');
    await arrived.promise; controller.abort(); await rejected; await closed.promise;
  });
});

test('background accepts auth commands only from the popup and scopes cancellation to the sending document', async () => {
  await upstream(async ({ origin, respond, received }) => {
    const storage = storageBoundary();
    const handler = createBackground({ runtime: { id: 'test-extension' }, storage: { local: storage.port } }, { apiOrigin: origin });
    const popup = { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' };
    const content = { id: 'test-extension', url: 'https://application.example.test', tab: { id: 1 }, frameId: 0, documentId: 'doc-one' };
    respond(req => req.url.endsWith('/login') ? { status: 200, body: { accessToken: 'synthetic', expiresIn: 900, user: account } } : { status: 200, body: { ok: true } });
    const login = { type: 'autofill-auth-login', email: account.email, password: 'synthetic-password' };
    assert.equal((await handler(login, content)).ok, false);
    assert.equal(received.length, 0);
    assert.equal((await handler(login, popup)).ok, true);
    const status = await handler({ type: 'autofill-settings-load' }, content);
    assert.deepEqual(Object.keys(status).sort(), ['authenticated', 'state']);
    assert.equal((await handler({ type: 'autofill-settings-save', settings: { backendUrl: 'https://evil.test' } }, popup)).ok, false);
    const arrived = deferred(), closed = deferred();
    let upstreamClosed = false;
    respond((_req, _input, res) => { res.on('close', () => { upstreamClosed = true; closed.resolve(); }); arrived.resolve(); });
    const input = metadata();
    const pending = handler({ type: 'autofill-request', operation: 'analyze', input }, content);
    await arrived.promise;
    assert.equal((await handler({ type: 'autofill-request', operation: 'analyze', input }, content)).error.code, 'duplicate-request');
    await handler({ type: 'autofill-cancel-request', requestId: input.requestId }, { ...content, documentId: 'other-document' });
    assert.equal(upstreamClosed, false);
    await handler({ type: 'autofill-cancel-request', requestId: input.requestId }, content);
    assert.equal((await pending).error.code, 'cancelled'); await closed.promise;
    assert.equal((await handler({ type: 'autofill-request', operation: 'analyze', input: metadata() }, { ...content, frameId: 1 })).ok, false);
  });
});
