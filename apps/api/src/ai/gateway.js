const crypto = require('node:crypto');
const { AiError, normalizeProviderError } = require('./errors');
const { backoffMs, getAiPolicy } = require('./policy');
const { createProvider } = require('./providers');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createAiGateway = ({ providerFactory = createProvider, sleepFn = sleep, now = () => Date.now() } = {}) => ({
  async run({ task, input, userId, requestId = crypto.randomUUID(), validate, messages, schema, capability = 'text', policy: policyOverride }) {
    if (!task || typeof input !== 'object') throw new AiError('AI 任务参数不完整', 'AI_INVALID_INPUT', { status: 400 });
    const policy = getAiPolicy(task, policyOverride, capability);
    const attempts = [];
    let lastError;
    for (let index = 0; index < policy.maxAttempts; index += 1) {
      const attempt = index + 1;
      const tier = policy.tiers[index] || policy.tiers.at(-1);
      const provider = providerFactory(tier, capability);
      const startedAt = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
      try {
        const result = await provider.completeStructured({ task, input, userId, requestId, capability, messages, schema, signal: controller.signal });
        if (validate) {
          const validation = validate(result);
          if (!validation.ok) throw new AiError(validation.message || 'AI 结果不符合预期格式', 'AI_INVALID_OUTPUT', { retryable: true });
        }
        attempts.push({ attempt, tier, capability, provider: provider.name, model: provider.model, status: 'succeeded', latencyMs: now() - startedAt });
        return { data: result, requestId, attempts };
      } catch (error) {
        const normalized = normalizeProviderError(error);
        lastError = normalized;
        attempts.push({ attempt, tier, capability, provider: provider.name, model: provider.model, status: 'failed', code: normalized.code, retryable: normalized.retryable, latencyMs: now() - startedAt });
        if (!normalized.retryable || attempt >= policy.maxAttempts) break;
        await sleepFn(backoffMs(attempt, policy, normalized.retryAfterMs));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new AiError(lastError?.message || 'AI 服务暂时不可用', lastError?.code || 'AI_FAILED', {
      retryable: false,
      status: lastError?.status || 502,
      cause: { requestId, attempts },
    });
  },
});

module.exports = { createAiGateway };
