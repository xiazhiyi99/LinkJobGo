import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiError } = require('../src/ai/errors.js');
const { createAiGateway } = require('../src/ai/gateway.js');
const { validateResumeResult } = require('../src/ai/tasks/resume-parse.js');
const { createVisionExtractService } = require('../src/ai/tasks/vision-extract.js');
const { createResumeNormalizeService } = require('../src/ai/tasks/resume-normalize.js');
const { createResumePdfService, decodePdf } = require('../src/ai/tasks/resume-pdf.js');
const { normalizePayload } = require('../src/profile/resume-import.js');

test('PDF file input rejects non-PDF content before rendering', () => {
  assert.throws(() => decodePdf(Buffer.from('not a pdf').toString('base64')), (error) => error.code === 'AI_INVALID_INPUT');
});

test('parse-file text path returns normalized database-ready payload without persistence', async () => {
  const calls = [];
  const service = createResumePdfService({
    visionExtractService: { extract: async () => { throw new Error('vision should not run for text'); } },
    resumeParseService: { parse: async (input) => { calls.push(['parse', input.filename]); return { data: { profile: { name: '测试' }, preferences: {}, records: { educations: [] } }, attempts: [{ status: 'succeeded' }] }; } },
    resumeNormalizeService: { normalize: async ({ payload }) => { calls.push(['normalize', payload.profile.name]); return { data: { profile: payload.profile, preferences: {}, records: { educations: [] } }, attempts: [{ status: 'succeeded' }] }; } },
    normalizePayload,
  });
  const result = await service.parseFile({ filename: 'resume.txt', contentType: 'text/plain', contentBase64: Buffer.from('姓名：测试').toString('base64'), userId: 'u1', requestId: 'r1' });
  assert.deepEqual(calls, [['parse', 'resume.txt'], ['normalize', '测试']]);
  assert.equal(result.data.profile.name, '测试');
  assert.equal(result.databaseReady.profile.name, '测试');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.pages, 0);
});

test('parse-file rejects legacy .doc files with an actionable error', async () => {
  const service = createResumePdfService({ visionExtractService: {}, resumeParseService: {}, resumeNormalizeService: {}, normalizePayload });
  await assert.rejects(() => service.parseFile({ filename: 'resume.doc', contentType: 'application/msword', contentBase64: Buffer.from('legacy').toString('base64') }), (error) => error.code === 'AI_INVALID_INPUT' && /DOCX|PDF/.test(error.message));
});

test('PDF parse uses OCR pages and returns the exact database projection preview', async () => {
  const calls = [];
  const canonical = { profile: { name: '赵舶凯' }, preferences: {}, records: { educations: [], experiences: [], projects: [], awards: [], publications: [], campusExperiences: [], skills: [], languages: [], certificates: [] }, unmapped: [] };
  const service = createResumePdfService({
    renderPdfFn: async (pdf, options) => { calls.push(['render', pdf.toString('ascii', 0, 5), options]); return [{ page: 1, mimeType: 'image/jpeg', data: 'aGVsbG8=' }]; },
    visionExtractService: { extract: async () => { throw new Error('vision should not run'); } },
    ocrService: { extract: async ({ images }) => { calls.push(['ocr', images.length]); return { data: { pages: [{ page: 1, text: '姓名：赵舶凯' }], text: '姓名：赵舶凯' }, attempts: [{ provider: 'baidu-ocr' }] }; } },
    resumeNormalizeService: { normalize: async ({ payload }) => { calls.push(['normalize', payload.text]); return { data: canonical, attempts: [{ provider: 'official' }] }; } },
    resumeParseService: {}, normalizePayload: (value) => value,
    databaseProjection: (value) => ({ profile: value.profile, educations: [], experiences: [], projects: [], skills: [], unmapped: [] }),
  });
  const result = await service.parseFile({ filename: 'resume.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF-test').toString('base64'), userId: 'u1', requestId: 'r-pdf' });
  assert.deepEqual(calls.map((item) => item[0]), ['render', 'ocr', 'normalize']);
  assert.equal(calls[0][2].dpi, 150);
  assert.equal(result.databaseRows.profile.name, '赵舶凯');
  assert.equal(result.pages, 1);
  assert.equal(result.attempts.length, 2);
});

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
  assert.equal(received.tier, 'official');
  assert.equal(received.capability, 'vision');
  assert.equal(received.args.messages[1].content[1].type, 'image_url');
  assert.match(received.args.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
});

test('resume normalizer requests canonical sections through the gateway', async () => {
  let received;
  const gateway = createAiGateway({
    providerFactory: () => ({ name: 'normalizer-test', model: 'normalizer-model', async completeStructured(args) { received = args; return { profile: {}, preferences: {}, records: { educations: [], experiences: [], projects: [], awards: [], publications: [], campusExperiences: [], skills: [], languages: [], certificates: [] }, unmapped: [] }; } }),
  });
  const service = createResumeNormalizeService(gateway);
  const result = await service.normalize({ payload: { records: { educations: [{ honors: ['奖项'] }] } }, userId: 'u1' });
  assert.equal(result.data.records.awards.length, 0);
  assert.match(received.messages[0].content, /canonical JSON/);
});

test('vision gateway follows cheap-then-official strategy when configured', async () => {
  const original = process.env.AI_VLM_RETRY_STRATEGY;
  process.env.AI_VLM_RETRY_STRATEGY = 'cheap_then_official';
  const calls = [];
  try {
    const gateway = createAiGateway({
      providerFactory: (tier, capability) => provider(tier, (currentTier) => {
        calls.push({ tier: currentTier, capability });
        if (calls.length < 3) throw new AiError('temporary failure', 'AI_TIMEOUT', { retryable: true });
        return { fields: {}, records: {} };
      }),
      sleepFn: async () => {},
    });
    const service = createVisionExtractService(gateway);
    await service.extract({ images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }] });
    assert.deepEqual(calls, [
      { tier: 'cheap', capability: 'vision' },
      { tier: 'cheap', capability: 'vision' },
      { tier: 'official', capability: 'vision' },
    ]);
  } finally {
    if (original === undefined) delete process.env.AI_VLM_RETRY_STRATEGY;
    else process.env.AI_VLM_RETRY_STRATEGY = original;
  }
});

test('vision defaults to official-only while text keeps cheap fallback strategy', async () => {
  const { getAiPolicy } = require('../src/ai/policy.js');
  const originalVision = process.env.AI_VLM_RETRY_STRATEGY;
  const originalText = process.env.AI_TEXT_RETRY_STRATEGY;
  delete process.env.AI_VLM_RETRY_STRATEGY;
  delete process.env.AI_TEXT_RETRY_STRATEGY;
  try {
    assert.deepEqual(getAiPolicy('vision.extract', {}, 'vision').tiers, ['official']);
    assert.equal(getAiPolicy('vision.extract', {}, 'vision').maxAttempts, 1);
    assert.deepEqual(getAiPolicy('resume.parse', {}, 'text').tiers, ['cheap', 'cheap', 'official']);
  } finally {
    if (originalVision === undefined) delete process.env.AI_VLM_RETRY_STRATEGY;
    else process.env.AI_VLM_RETRY_STRATEGY = originalVision;
    if (originalText === undefined) delete process.env.AI_TEXT_RETRY_STRATEGY;
    else process.env.AI_TEXT_RETRY_STRATEGY = originalText;
  }
});

test('vision strategy can switch to cheap twice then official from env', async () => {
  const { getAiPolicy } = require('../src/ai/policy.js');
  const original = process.env.AI_VLM_RETRY_STRATEGY;
  process.env.AI_VLM_RETRY_STRATEGY = 'cheap_then_official';
  try {
    const policy = getAiPolicy('vision.extract', {}, 'vision');
    assert.deepEqual(policy.tiers, ['cheap', 'cheap', 'official']);
    assert.equal(policy.maxAttempts, 3);
  } finally {
    if (original === undefined) delete process.env.AI_VLM_RETRY_STRATEGY;
    else process.env.AI_VLM_RETRY_STRATEGY = original;
  }
});
