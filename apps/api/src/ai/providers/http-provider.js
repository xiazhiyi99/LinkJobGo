const { AiError, isRetryableStatus } = require('../errors');

const parseJson = async (response, maxBytes) => {
  let text;
  if (maxBytes === undefined) text = await response.text();
  else {
    const reader = response.body?.getReader();
    if (!reader) throw new AiError('AI 响应为空', 'AI_INVALID_RESPONSE', { retryable: true });
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new AiError('AI 响应超过体积限制', 'AI_RESPONSE_TOO_LARGE');
        chunks.push(chunk.value);
      }
      text = Buffer.concat(chunks).toString('utf8');
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
};

const createHttpProvider = ({ tier, provider = 'openai-compatible', baseUrl, apiKey, model }) => ({
  name: provider,
  tier,
  model,
  async completeStructured({ task, messages, schema, signal, requestId, maxResponseBytes, redirect }) {
    if (!baseUrl || !apiKey || !model) throw new AiError(`未配置 ${tier} AI 服务`, 'AI_PROVIDER_NOT_CONFIGURED', { retryable: false, status: 503 });
    let response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal,
        ...(redirect ? { redirect } : {}),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'x-request-id': requestId },
        body: JSON.stringify({
          model,
          messages,
          // Resume normalization is a schema extraction task. A zero
          // temperature reduces semantic field drift between retries/runs;
          // interactive autofill keeps the slightly more flexible default.
          temperature: task === 'resume.normalize' ? 0 : 0.1,
          response_format: { type: 'json_object' },
          metadata: { request_id: requestId },
        }),
      });
    } catch (error) {
      throw error;
    }
    const payload = await parseJson(response, maxResponseBytes);
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new AiError(payload?.error?.message || `AI 服务返回 ${response.status}`, `AI_HTTP_${response.status}`, {
        retryable: isRetryableStatus(response.status), status: response.status, retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
      });
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new AiError('AI 响应缺少结构化内容', 'AI_INVALID_RESPONSE', { retryable: true });
    try { return JSON.parse(content); } catch (error) { throw new AiError('AI 响应不是有效 JSON', 'AI_INVALID_JSON', { retryable: true, cause: error }); }
  },
});

module.exports = { createHttpProvider };
