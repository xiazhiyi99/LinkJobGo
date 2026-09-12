const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const defaultPolicy = () => ({
  maxAttempts: numberFromEnv('AI_MAX_ATTEMPTS', 3),
  timeoutMs: numberFromEnv('AI_TIMEOUT_MS', 30_000),
  retryBaseMs: numberFromEnv('AI_RETRY_BASE_MS', 500),
  retryMaxMs: numberFromEnv('AI_RETRY_MAX_MS', 5_000),
  tiers: ['cheap', 'cheap', 'official'],
});

const taskPolicies = {
  'resume.parse': defaultPolicy,
  'autofill.suggest': defaultPolicy,
};

const getAiPolicy = (task, override = {}) => {
  const factory = taskPolicies[task] || defaultPolicy;
  const base = factory();
  const tiers = Array.isArray(override.tiers) && override.tiers.length ? override.tiers : base.tiers;
  return {
    ...base,
    ...override,
    tiers,
    maxAttempts: Math.min(Math.max(1, Number(override.maxAttempts || base.maxAttempts)), tiers.length),
  };
};

const backoffMs = (attempt, policy, retryAfterMs) => {
  if (Number.isFinite(retryAfterMs)) return Math.min(policy.retryMaxMs, Math.max(0, retryAfterMs));
  const exponential = Math.min(policy.retryMaxMs, policy.retryBaseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.floor(exponential * (0.75 + Math.random() * 0.5));
};

module.exports = { getAiPolicy, backoffMs };
