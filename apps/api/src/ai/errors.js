class AiError extends Error {
  constructor(message, code, { retryable = false, status = 502, cause, retryAfterMs } = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.cause = cause;
    this.retryAfterMs = retryAfterMs;
  }
}

const isRetryableStatus = (status) => status === 408 || status === 409 || status === 429 || status >= 500;

const normalizeProviderError = (error) => {
  if (error instanceof AiError) return error;
  if (error?.name === 'AbortError') return new AiError('AI 请求超时', 'AI_TIMEOUT', { retryable: true, status: 504, cause: error });
  if (error?.code === 'ECONNRESET' || error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') {
    return new AiError('AI 服务连接失败', 'AI_PROVIDER_UNAVAILABLE', { retryable: true, status: 503, cause: error });
  }
  return new AiError(error?.message || 'AI 服务调用失败', 'AI_PROVIDER_ERROR', { retryable: true, status: 502, cause: error });
};

module.exports = { AiError, isRetryableStatus, normalizeProviderError };
