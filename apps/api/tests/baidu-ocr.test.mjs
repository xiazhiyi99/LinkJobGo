import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBaiduOcrService } = require('../src/ai/providers/baidu-ocr.js');

const tokenUrl = 'https://aip.baidubce.com/oauth/2.0/token';
const ocrUrl = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic';
const response = (payload, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] },
  text: async () => JSON.stringify(payload),
});
const image = (page = 1) => ({ data: Buffer.from(`page-${page}`).toString('base64'), mimeType: 'image/png', page });

test('uses accurate_basic without location options and preserves page order', async () => {
  const calls = [];
  let pageCalls = 0;
  const service = createBaiduOcrService({
    apiKey: 'ak-test', secretKey: 'sk-test',
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      if (url === tokenUrl) return response({ access_token: 'token-1', expires_in: 3600 });
      assert.equal(url.startsWith(`${ocrUrl}?access_token=token-1`), true);
      assert.equal(new URLSearchParams(options.body).has('location'), false);
      assert.deepEqual([...new URLSearchParams(options.body).keys()], ['image']);
      pageCalls += 1;
      return response({ words_result: [{ words: pageCalls === 1 ? 'second-page' : 'first-page' }] });
    },
  });
  const result = await service.extract({ images: [image(2), image(1)], requestId: 'req-1', userId: 'user-1' });
  assert.deepEqual(result.data.pages, [{ page: 2, text: 'second-page' }, { page: 1, text: 'first-page' }]);
  assert.equal(result.data.text, 'second-page\nfirst-page');
  assert.equal(result.requestId, 'req-1');
  assert.equal(calls.filter(({ url }) => url === tokenUrl).length, 1);
  assert.equal(calls.filter(({ url }) => url.startsWith(ocrUrl)).length, 2);
  assert.equal(result.attempts.every((attempt) => attempt.provider === 'baidu-ocr' && attempt.capability === 'ocr'), true);
});

test('reuses a valid token across sequential extracts', async () => {
  let tokenCalls = 0;
  let ocrCalls = 0;
  const service = createBaiduOcrService({
    apiKey: 'ak-test', secretKey: 'sk-test',
    fetchFn: async (url) => {
      if (url === tokenUrl) { tokenCalls += 1; return response({ access_token: 'cached', expires_in: 3600 }); }
      ocrCalls += 1;
      return response({ words_result: [{ words: 'ok' }] });
    },
  });
  await service.extract({ images: [image()] });
  await service.extract({ images: [image()] });
  assert.equal(tokenCalls, 1);
  assert.equal(ocrCalls, 2);
});

test('fetches a new token after the cached token expires', async () => {
  let clock = 0;
  let tokenCalls = 0;
  const service = createBaiduOcrService({
    apiKey: 'ak-test', secretKey: 'sk-test', now: () => clock,
    fetchFn: async (url) => {
      if (url === tokenUrl) { tokenCalls += 1; return response({ access_token: `expiring-${tokenCalls}`, expires_in: 1 }); }
      return response({ words_result: [{ words: 'ok' }] });
    },
  });
  await service.extract({ images: [image()] });
  clock = 1001;
  await service.extract({ images: [image()] });
  assert.equal(tokenCalls, 2);
});

test('deduplicates concurrent token acquisition', async () => {
  let tokenCalls = 0;
  const service = createBaiduOcrService({
    apiKey: 'ak-test', secretKey: 'sk-test',
    fetchFn: async (url) => {
      if (url === tokenUrl) {
        tokenCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 2));
        return response({ access_token: 'shared', expires_in: 3600 });
      }
      return response({ words_result: [{ words: 'ok' }] });
    },
  });
  await Promise.all([service.extract({ images: [image(1)] }), service.extract({ images: [image(2)] })]);
  assert.equal(tokenCalls, 1);
});

test('retries transient HTTP failures with bounded backoff', async () => {
  let ocrCalls = 0;
  const waits = [];
  const service = createBaiduOcrService({
    apiKey: 'ak-test', secretKey: 'sk-test', sleepFn: async (ms) => waits.push(ms),
    fetchFn: async (url) => {
      if (url === tokenUrl) return response({ access_token: 'retry-token', expires_in: 3600 });
      ocrCalls += 1;
      if (ocrCalls < 3) return response({ error_code: 18, error_msg: 'secret-body-must-not-leak' });
      return response({ words_result: [{ words: 'recovered' }] });
    },
  });
  const result = await service.extract({ images: [image()] });
  assert.equal(result.data.text, 'recovered');
  assert.equal(ocrCalls, 3);
  assert.equal(waits.length, 2);
});

test('refreshes an invalid token once and stops on a second invalid token', async () => {
  let tokenCalls = 0;
  let ocrCalls = 0;
  const service = createBaiduOcrService({
    apiKey: 'ak-test', secretKey: 'sk-test',
    fetchFn: async (url) => {
      if (url === tokenUrl) {
        tokenCalls += 1;
        return response({ access_token: `token-${tokenCalls}`, expires_in: 3600 });
      }
      ocrCalls += 1;
      if (ocrCalls === 1) return response({ error_code: 110, error_msg: 'token-1' });
      return response({ words_result: [{ words: 'fresh-token-ok' }] });
    },
  });
  const result = await service.extract({ images: [image()] });
  assert.equal(result.data.text, 'fresh-token-ok');
  assert.equal(tokenCalls, 2);
  assert.equal(ocrCalls, 2);

  let secondFailureCalls = 0;
  const secondFailureService = createBaiduOcrService({
    apiKey: 'ak-test', secretKey: 'sk-test',
    fetchFn: async (url) => {
      if (url === tokenUrl) return response({ access_token: `bad-${++secondFailureCalls}`, expires_in: 3600 });
      secondFailureCalls += 1;
      return response({ error_code: 111 });
    },
    sleepFn: async () => { throw new Error('invalid tokens must not be retried'); },
  });
  await assert.rejects(() => secondFailureService.extract({ images: [image()] }), (error) => error.code === 'AI_BAIDU_111');
  assert.equal(secondFailureCalls, 4); // two token fetches and two OCR calls
});

test('does not retry quota failures and rejects malformed or empty output', async () => {
  let tokenCalls = 0;
  const quotaService = createBaiduOcrService({
    apiKey: 'ak-test', secretKey: 'sk-test',
    fetchFn: async (url) => {
      if (url === tokenUrl) { tokenCalls += 1; return response({ error_code: 17, error_msg: 'private raw body' }, 400); }
      throw new Error('unexpected OCR call');
    },
  });
  await assert.rejects(() => quotaService.extract({ images: [image()] }), (error) => {
    assert.equal(error.code, 'AI_BAIDU_17');
    assert.equal(error.message.includes('private raw body'), false);
    return true;
  });
  assert.equal(tokenCalls, 1);

  const badService = createBaiduOcrService({
    apiKey: 'ak-test', secretKey: 'sk-test',
    fetchFn: async (url) => url === tokenUrl ? response({ access_token: 'bad', expires_in: 3600 }) : response({ words_result: [{}] }),
  });
  await assert.rejects(() => badService.extract({ images: [image()] }), (error) => error.code === 'AI_INVALID_RESPONSE');
});
