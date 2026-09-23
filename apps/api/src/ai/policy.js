const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const TIER_STRATEGIES = {
  official_only: ['official'],
  cheap_then_official: ['cheap', 'cheap', 'official'],
  cheap_only: ['cheap'],
};

const normalizeStrategy = (value, fallback) => {
  const strategy = String(value || fallback).trim().toLowerCase();
  return TIER_STRATEGIES[strategy] ? strategy : fallback;
};

const strategyForCapability = (capability, task) => {
  const taskEnv = task === 'resume.normalize' ? process.env.AI_RESUME_RETRY_STRATEGY : undefined;
  if (taskEnv) return normalizeStrategy(taskEnv, capability === 'vision' ? 'official_only' : 'cheap_then_official');
  if (capability === 'vision') {
    return normalizeStrategy(process.env.AI_VLM_RETRY_STRATEGY, 'official_only');
  }
  return normalizeStrategy(process.env.AI_TEXT_RETRY_STRATEGY || process.env.AI_RETRY_STRATEGY, 'cheap_then_official');
};

const defaultPolicy = (capability = 'text', task) => {
  const strategy = strategyForCapability(capability, task);
  const tiers = [...TIER_STRATEGIES[strategy]];
  return {
    maxAttempts: Math.min(numberFromEnv('AI_MAX_ATTEMPTS', tiers.length), tiers.length),
    timeoutMs: task === 'resume.normalize' ? numberFromEnv('AI_RESUME_TIMEOUT_MS', 90_000) : numberFromEnv('AI_TIMEOUT_MS', 30_000),
    retryBaseMs: numberFromEnv('AI_RETRY_BASE_MS', 500),
    retryMaxMs: numberFromEnv('AI_RETRY_MAX_MS', 5_000),
    tiers,
    strategy,
  };
};

const taskPolicies = {
  'resume.parse': defaultPolicy,
  'resume.normalize': defaultPolicy,
  'autofill.suggest': defaultPolicy,
  'vision.extract': defaultPolicy,
  'mail.classify': defaultPolicy,
};

const getAiPolicy = (task, override = {}, capability = 'text') => {
  const factory = taskPolicies[task] || defaultPolicy;
  const base = factory(capability, task);
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

module.exports = { getAiPolicy, backoffMs, strategyForCapability, TIER_STRATEGIES };
