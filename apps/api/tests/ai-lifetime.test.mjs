import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAiGateway } = require('../src/ai/gateway');
const { createHttpProvider } = require('../src/ai/providers/http-provider');
const { AiError } = require('../src/ai/errors');
const task = { task: 'autofill.map-fields', input: {}, requestId: 'lifetime-test' };
const policy = { tiers: ['official', 'official', 'official'], maxAttempts: 3, timeoutMs: 1000, retryBaseMs: 0 };

test('pre-cancelled or expired requests never construct a provider', async () => {
  const gateway = createAiGateway({ providerFactory: () => { assert.fail('provider should not start'); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(gateway.run({ ...task, signal: controller.signal }), e => e.code === 'AI_CANCELLED');
  await assert.rejects(gateway.run({ ...task, deadlineAt: Date.now() - 1 }), e => e.code === 'AI_DEADLINE_EXCEEDED');
  await assert.rejects(gateway.run({ ...task, deadlineAt: Infinity }), e => e.code === 'AI_INVALID_INPUT');
});

test('one total deadline cancels an uncooperative provider and discards late success', async () => {
  let calls = 0, deliveredSignal, complete;
  const gateway = createAiGateway({ providerFactory: () => ({ name: 'controlled', model: 'test', completeStructured({ signal }) { calls++; deliveredSignal = signal; return new Promise(resolve => { complete = resolve; }); } }) });
  await assert.rejects(gateway.run({ ...task, policy, deadlineAt: Date.now() + 30 }), e => e.code === 'AI_DEADLINE_EXCEEDED');
  assert.equal(calls, 1); assert.equal(deliveredSignal.aborted, true);
  complete({ shouldBeDiscarded: true });
});

test('cancellation during backoff stops the wait and prevents the next attempt', async () => {
  let calls = 0, backoffStarted;
  const waiting = new Promise(resolve => { backoffStarted = resolve; });
  const controller = new AbortController();
  const gateway = createAiGateway({
    providerFactory: () => ({ name: 'controlled', model: 'test', async completeStructured() { calls++; throw new AiError('transient', 'TEST_TRANSIENT', { retryable: true }); } }),
    sleepFn: () => { backoffStarted(); return new Promise(() => {}); },
  });
  const pending = gateway.run({ ...task, policy, signal: controller.signal, deadlineAt: Date.now() + 1000 });
  const rejected = assert.rejects(pending, e => e.code === 'AI_CANCELLED');
  await waiting; controller.abort(); await rejected;
  assert.equal(calls, 1);
});

test('retry waits consume remaining budget and per-attempt timeout can still retry within it', async () => {
  let calls = 0;
  const gateway = createAiGateway({ providerFactory: () => ({ name: 'controlled', model: 'test', async completeStructured() { calls++; throw new AiError('rate limited', 'TEST_RATE', { retryable: true, retryAfterMs: 60_000 }); } }) });
  await assert.rejects(gateway.run({ ...task, deadlineAt: Date.now() + 30, policy: { ...policy, retryMaxMs: 60_000 } }), e => e.code === 'AI_DEADLINE_EXCEEDED');
  assert.equal(calls, 1);
  calls = 0;
  const retrying = createAiGateway({ providerFactory: () => ({ name: 'controlled', model: 'test', completeStructured() { calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve({ bindings: [] }); } }) });
  const result = await retrying.run({ ...task, policy: { ...policy, timeoutMs: 10 }, deadlineAt: Date.now() + 500 });
  assert.equal(calls, 2); assert.equal(result.attempts[0].code, 'AI_TIMEOUT'); assert.equal(result.attempts[1].status, 'succeeded');
});

test('HTTP provider bounds streaming bytes and rejects redirects for constrained tasks', async () => {
  let redirected = 0;
  const server = createServer((req, res) => {
    if (req.url === '/large/chat/completions') { res.write('x'.repeat(80)); res.end('x'.repeat(80)); }
    else if (req.url === '/redirect/chat/completions') { res.writeHead(302, { location: '/destination' }); res.end(); }
    else { redirected++; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const mode of ['large', 'redirect']) {
      const provider = createHttpProvider({ tier: 'official', baseUrl: `http://127.0.0.1:${server.address().port}/${mode}`, apiKey: 'synthetic-only', model: 'test' });
      await assert.rejects(provider.completeStructured({ ...task, messages: [], maxResponseBytes: 100, redirect: 'error' }), e => mode === 'large' ? e.code === 'AI_RESPONSE_TOO_LARGE' : e instanceof TypeError);
    }
    assert.equal(redirected, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
