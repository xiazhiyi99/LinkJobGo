const { randomUUID } = require('node:crypto');
const { AiError } = require('../errors');

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const OCR_URL = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic';
const MAX_PAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_ENCODED_IMAGE_BYTES = 10 * 1024 * 1024;
const TRANSIENT_CODES = new Set([4, 18, 282000, 336000, 336100]);
const INVALID_TOKEN_CODES = new Set([100, 110, 111]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const invalidInput = (message, code = 'AI_INVALID_INPUT', status = 400) => new AiError(message, code, { status });
const timeoutError = () => new AiError('百度 OCR 请求超时', 'AI_TIMEOUT', { retryable: true, status: 504 });
const networkError = () => new AiError('百度 OCR 网络请求失败', 'AI_PROVIDER_UNAVAILABLE', { retryable: true, status: 503 });
const invalidResponse = () => new AiError('百度 OCR 返回结果格式无效', 'AI_INVALID_RESPONSE', { status: 502 });

const responseIsOk = (response) => {
  if (typeof response?.ok === 'boolean') return response.ok;
  const status = Number(response?.status);
  return Number.isFinite(status) && status >= 200 && status < 300;
};

const responseJson = async (response) => {
  if (typeof response?.text === 'function') {
    const raw = await response.text();
    if (raw) {
      try { return JSON.parse(raw); } catch { return undefined; }
    }
  }
  if (typeof response?.json === 'function') return response.json();
  return undefined;
};

const retryDelay = (response, now) => {
  const value = response?.headers?.get?.('retry-after');
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.min(10_000, Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(10_000, date - now())) : undefined;
};

const validateImages = (images) => {
  if (!Array.isArray(images) || images.length === 0 || images.length > MAX_PAGES) {
    throw invalidInput(`OCR 输入需要 1 到 ${MAX_PAGES} 张图片`);
  }
  const pages = new Set();
  let totalBytes = 0;
  return images.map((image, index) => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) throw invalidInput('OCR 图片参数无效');
    const mimeType = image.mimeType || 'image/jpeg';
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp'].includes(mimeType)) {
      throw invalidInput('百度 OCR 仅支持 JPEG、PNG、WebP 或 BMP 图片');
    }
    if (typeof image.data !== 'string' || image.data.length > MAX_ENCODED_IMAGE_BYTES) throw invalidInput('OCR 图片必须使用有效的 base64 编码');
    const data = image.data.replace(/\s/g, '');
    if (!data || data.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw invalidInput('OCR 图片必须使用有效的 base64 编码');
    const bytes = Buffer.from(data, 'base64');
    const normalized = data.replace(/=+$/, '');
    if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== normalized || (data.includes('=') && data.length % 4 !== 0)) {
      throw invalidInput('OCR 图片必须使用有效的 base64 编码');
    }
    const body = new URLSearchParams({ image: data });
    if (bytes.length > MAX_IMAGE_BYTES || Buffer.byteLength(body.toString(), 'utf8') > MAX_ENCODED_IMAGE_BYTES) {
      throw new AiError('OCR 单张图片不能超过 5MB，编码后不能超过 10MB', 'AI_INPUT_TOO_LARGE', { status: 413 });
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new AiError('OCR 图片总大小不能超过 8MB', 'AI_INPUT_TOO_LARGE', { status: 413 });
    const page = image.page === undefined ? index + 1 : image.page;
    if (!Number.isSafeInteger(page) || page < 1 || pages.has(page)) throw invalidInput('OCR 页面编号必须为不重复的正整数');
    pages.add(page);
    return { body, page };
  });
};

const providerError = (response, payload, now) => {
  const status = Number(response?.status) || 502;
  const code = Number(payload?.error_code);
  const hasBaiduCode = Number.isSafeInteger(code) && code > 0;
  const oauthCode = typeof payload?.error === 'string' ? payload.error : undefined;
  const retryable = hasBaiduCode
    ? TRANSIENT_CODES.has(code)
    : oauthCode ? ['server_error', 'temporarily_unavailable'].includes(oauthCode)
      : status === 408 || status === 409 || status === 429 || status >= 500;
  const safeCode = hasBaiduCode ? `AI_BAIDU_${code}` : oauthCode ? 'AI_BAIDU_AUTH_ERROR' : `AI_HTTP_${status}`;
  return new AiError([17, 19].includes(code) ? '百度 OCR 调用额度已用尽' : '百度 OCR 服务请求失败', safeCode, {
    retryable,
    status: status >= 400 && status <= 599 ? status : 502,
    retryAfterMs: retryDelay(response, now),
  });
};

const getPageText = (payload) => {
  const words = payload?.words_result;
  if (!Array.isArray(words) || (payload.words_result_num !== undefined && Number(payload.words_result_num) !== words.length)) throw invalidResponse();
  if (!words.length) throw new AiError('百度 OCR 未识别到文字，请检查页面清晰度', 'AI_EMPTY_OUTPUT', { status: 422 });
  if (words.some((entry) => typeof entry?.words !== 'string' || !entry.words.trim())) throw invalidResponse();
  return words.map((entry) => entry.words).join('\n');
};

const createBaiduOcrService = ({
  fetchFn = fetch,
  now = Date.now,
  sleepFn = sleep,
  apiKey = process.env.BAIDU_OCR_API_KEY,
  secretKey = process.env.BAIDU_OCR_SECRET_KEY,
  timeoutMs = 15_000,
  maxAttempts = 3,
} = {}) => {
  const timeout = Math.min(120_000, Math.max(1, Number(timeoutMs) || 15_000));
  const attemptLimit = Math.min(5, Math.max(1, Math.floor(Number(maxAttempts) || 3)));
  let cachedToken;
  let tokenPromise;

  const requestJson = async (url, body) => {
    const controller = new AbortController();
    let timer;
    const work = async () => {
      let response;
      try {
        response = await fetchFn(url, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        });
        const payload = await responseJson(response);
        if (!responseIsOk(response) || (Number(payload?.error_code) > 0) || payload?.error !== undefined) throw providerError(response, payload, now);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidResponse();
        return payload;
      } catch (error) {
        if (error instanceof AiError) throw error;
        throw controller.signal.aborted || error?.name === 'AbortError' ? timeoutError() : networkError();
      }
    };
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(timeoutError()); }, timeout);
      })]);
    } finally {
      clearTimeout(timer);
    }
  };

  const loadToken = async () => {
    if (typeof apiKey !== 'string' || !apiKey.trim() || typeof secretKey !== 'string' || !secretKey.trim()) {
      throw new AiError('未配置百度 OCR 服务', 'AI_PROVIDER_NOT_CONFIGURED', { status: 503 });
    }
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: apiKey, client_secret: secretKey });
    for (let attempt = 1; ; attempt += 1) {
      try {
        const startedAt = now();
        const payload = await requestJson(TOKEN_URL, body);
        const lifetimeMs = Number(payload.expires_in) * 1000;
        if (typeof payload.access_token !== 'string' || !payload.access_token.trim() || !Number.isFinite(lifetimeMs) || lifetimeMs <= 0) throw invalidResponse();
        cachedToken = { value: payload.access_token, expiresAt: startedAt + lifetimeMs - (lifetimeMs > 60_000 ? 60_000 : 0) };
        return cachedToken.value;
      } catch (error) {
        if (!error.retryable || attempt >= attemptLimit) throw error;
        await sleepFn(error.retryAfterMs ?? Math.min(500 * (2 ** (attempt - 1)), 3000));
      }
    }
  };

  const getToken = async (invalidValue) => {
    if (invalidValue && cachedToken?.value === invalidValue) cachedToken = undefined;
    if (cachedToken && now() < cachedToken.expiresAt) return cachedToken.value;
    if (!tokenPromise) tokenPromise = loadToken().finally(() => { tokenPromise = undefined; });
    return tokenPromise;
  };

  return {
    async extract({ images, userId, requestId } = {}) {
      const normalizedImages = validateImages(images);
      const id = requestId || randomUUID();
      const attempts = [];
      const pages = [];
      let refreshUsed = false;
      try {
        for (const image of normalizedImages) {
          let transientFailures = 0;
          let callAttempt = 0;
          for (;;) {
            const token = await getToken();
            const startedAt = now();
            const details = { page: image.page, attempt: ++callAttempt, tier: 'official', capability: 'ocr', provider: 'baidu-ocr', model: 'accurate_basic' };
            try {
              const payload = await requestJson(`${OCR_URL}?access_token=${encodeURIComponent(token)}`, image.body);
              const text = getPageText(payload);
              attempts.push({ ...details, status: 'succeeded', latencyMs: now() - startedAt });
              pages.push({ page: image.page, text });
              break;
            } catch (error) {
              const invalidToken = INVALID_TOKEN_CODES.has(Number(error.code?.replace('AI_BAIDU_', ''))) || error.code === 'AI_HTTP_401';
              attempts.push({ ...details, status: 'failed', code: error.code, retryable: error.retryable, latencyMs: now() - startedAt });
              if (invalidToken && !refreshUsed) {
                refreshUsed = true;
                await getToken(token);
                continue;
              }
              if (invalidToken || !error.retryable || ++transientFailures >= attemptLimit) throw error;
              await sleepFn(error.retryAfterMs ?? Math.min(500 * (2 ** (transientFailures - 1)), 3000));
            }
          }
        }
        return { data: { pages, text: pages.map((page) => page.text).join('\n') }, requestId: id, attempts };
      } catch (error) {
        const safe = error instanceof AiError ? error : networkError();
        throw new AiError(safe.message, safe.code, { status: safe.status, cause: { requestId: id, attempts } });
      }
    },
  };
};

module.exports = { createBaiduOcrService };
