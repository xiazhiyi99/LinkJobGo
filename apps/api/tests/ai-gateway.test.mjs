import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiError } = require('../src/ai/errors.js');
const { createAiGateway } = require('../src/ai/gateway.js');
const { validateResumeResult } = require('../src/ai/tasks/resume-parse.js');
const { createVisionExtractService } = require('../src/ai/tasks/vision-extract.js');

const provider = (tier, behavior) => ({
  name: `${tier}-test`, tier, model: `${tier}-model`,
  async completeStructured() { return behavior(tier); },
});

test('cheap retries twice before switching to official model', async () => {
  const calls = [];
  const gateway = createAiGateway({
    providerFactory: (tier) => provider(tier, (currentTier) => {
      calls.push(currentTier);
      if (calls.length < 3) throw new AiError('temporary failure', 'AI_TIMEOUT', { retryable: true });
      return { profile: {}, preferences: {}, records: {} };
    }),
    sleepFn: async () => {},
  });
  const result = await gateway.run({ task: 'resume.parse', input: {}, validate: validateResumeResult });
  assert.deepEqual(calls, ['cheap', 'cheap', 'official']);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.attempts.at(-1).status, 'succeeded');
});

test('non-retryable provider errors stop immediately', async () => {
  let calls = 0;
  const gateway = createAiGateway({
    providerFactory: (tier) => provider(tier, () => { calls += 1; throw new AiError('bad request', 'AI_HTTP_400', { status: 400 }); }),
    sleepFn: async () => {},
  });
  await assert.rejects(() => gateway.run({ task: 'resume.parse', input: {}, validate: validateResumeResult }), (error) => error.code === 'AI_HTTP_400' && error.status === 400);
  assert.equal(calls, 1);
});

test('invalid structured output can fall back to official model', async () => {
  const tiers = [];
  const gateway = createAiGateway({
    providerFactory: (tier) => provider(tier, () => {
      tiers.push(tier);
      return tier === 'cheap' ? { invalid: true } : { profile: {}, preferences: {}, records: {} };
    }),
    sleepFn: async () => {},
  });
  const result = await gateway.run({ task: 'resume.parse', input: {}, validate: validateResumeResult });
  assert.deepEqual(tiers, ['cheap', 'cheap', 'official']);
  assert.equal(result.data.records && typeof result.data.records, 'object');
});

test('vision task uses the vision capability and structured image content', async () => {
  let received;
  const gateway = createAiGateway({
    providerFactory: (tier, capability) => ({
      name: `${tier}-${capability}`, model: `${tier}-vision`,
      async completeStructured(args) { received = { tier, capability, args }; return { fields: { name: '测试用户' }, records: {} }; },
    }),
  });
  const service = createVisionExtractService(gateway);
  const result = await service.extract({ images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }], userId: 'user-1' });
  assert.equal(result.data.fields.name, '测试用户');
  assert.equal(received.capability, 'vision');
  assert.equal(received.args.messages[1].content[1].type, 'image_url');
  assert.match(received.args.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
});
