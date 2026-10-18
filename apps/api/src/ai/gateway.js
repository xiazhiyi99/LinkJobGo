const crypto = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const { AiError, normalizeProviderError } = require('./errors');
const { backoffMs, getAiPolicy } = require('./policy');
const { createProvider } = require('./providers');

// Also bounds injected providers that do not observe AbortSignal. Late results
// are discarded; the real HTTP provider receives the same abort signal.
const waitFor = async (operation, signal) => {
  if (signal.aborted) throw signal.reason;
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { if (signal.aborted) throw signal.reason; return operation(); }), stopped]); }
  finally { signal.removeEventListener('abort', abort); }
};

const createAiGateway = ({ providerFactory = createProvider, sleepFn = (ms, signal) => sleep(ms, undefined, { signal }), now = () => Date.now(), onAttempt } = {}) => ({
  async run({ task, input, userId, requestId = crypto.randomUUID(), runId, validate, messages, schema, capability = 'text', policy: policyOverride, signal, deadlineAt, maxResponseBytes, redirect }) {
    if (!task || !input || typeof input !== 'object' || (deadlineAt !== undefined && !Number.isFinite(deadlineAt))) {
      throw new AiError('AI 任务参数不完整', 'AI_INVALID_INPUT', { status: 400 });
    }
    const policy = getAiPolicy(task, policyOverride, capability);
    const lifetime = new AbortController();
    const cancel = () => lifetime.abort(new AiError('AI 请求已取消', 'AI_CANCELLED', { status: 504 }));
    const expire = () => lifetime.abort(new AiError('AI 请求已超过截止时间', 'AI_DEADLINE_EXCEEDED', { status: 504 }));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const budget = deadlineAt === undefined ? Infinity : deadlineAt - now();
    if (budget <= 0) expire();
    const deadlineTimer = Number.isFinite(budget) && budget > 0 ? setTimeout(expire, Math.min(budget, 2_147_483_647)) : undefined;
    const check = () => {
      if (deadlineAt !== undefined && now() >= deadlineAt) expire();
      if (lifetime.signal.aborted) throw lifetime.signal.reason;
    };
    const attempts = [];
    let lastError;
    try {
      for (let index = 0; index < policy.maxAttempts; index += 1) {
        check();
        const attempt = index + 1;
        const tier = policy.tiers[index] || policy.tiers.at(-1);
        const startedAt = now();
        const controller = new AbortController();
        const stop = () => controller.abort(lifetime.signal.reason);
        lifetime.signal.addEventListener('abort', stop, { once: true });
        const timer = setTimeout(() => controller.abort(new AiError('AI 请求超时', 'AI_TIMEOUT', { retryable: true, status: 504 })), Math.min(policy.timeoutMs, deadlineAt === undefined ? Infinity : Math.max(0, deadlineAt - now())));
        let provider;
        let result;
        let succeeded = false;
        try {
          check();
          provider = providerFactory(tier, capability);
          result = await waitFor(() => provider.completeStructured({ task, input, userId, requestId, runId, capability, messages, schema, signal: controller.signal, maxResponseBytes, redirect }), controller.signal);
          check();
          if (validate) {
            const validation = validate(result);
            if (!validation.ok) throw new AiError(validation.message || 'AI 结果不符合预期格式', 'AI_INVALID_OUTPUT', { retryable: true });
          }
          succeeded = true;
        } catch (error) {
          lastError = lifetime.signal.aborted ? lifetime.signal.reason : normalizeProviderError(error);
        } finally {
          clearTimeout(timer);
          lifetime.signal.removeEventListener('abort', stop);
        }
        const event = { attempt, tier, capability, provider: provider?.name, model: provider?.model, status: succeeded ? 'succeeded' : 'failed', ...(!succeeded ? { code: lastError.code, retryable: lastError.retryable } : {}), latencyMs: now() - startedAt };
        attempts.push(event);
        // Diagnostics cannot alter the task or expose messages/source values.
        try { onAttempt?.({ task, requestId, runId, ...event }); } catch {}
        if (succeeded) return { data: result, requestId, attempts };
        check();
        if (!lastError.retryable || attempt >= policy.maxAttempts) break;
        await waitFor(() => sleepFn(Math.min(backoffMs(attempt, policy, lastError.retryAfterMs), deadlineAt === undefined ? Infinity : Math.max(0, deadlineAt - now())), lifetime.signal), lifetime.signal);
      }
      throw new AiError(lastError?.message || 'AI 服务暂时不可用', lastError?.code || 'AI_FAILED', { retryable: false, status: lastError?.status || 502, cause: { requestId, attempts } });
    } finally {
      clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', cancel);
    }
  },
});

module.exports = { createAiGateway };
