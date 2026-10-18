class ServiceError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const checkDeadline = (ctx) => {
  if (!Number.isFinite(ctx.deadlineAt)) throw new ServiceError('invalid-request', 'A finite deadline is required');
  if (ctx.signal?.aborted || Date.now() >= ctx.deadlineAt) {
    throw new ServiceError('deadline-exceeded', 'Operation cancelled or deadline exceeded', 504, true);
  }
};

module.exports = { ServiceError, checkDeadline };
