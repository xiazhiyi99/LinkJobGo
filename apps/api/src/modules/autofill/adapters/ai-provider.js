const { ServiceError, checkDeadline } = require('../errors');

// The resolver owns prompts and candidate validation. Gateway owns provider
// configuration, retries and cancellation; this adapter adds no retry loop.
const createGatewayAiProvider = ({ aiGateway }) => ({
  /** @param {import('../ai/index').AiRequest} request @param {import('../types').AiCallContext} context */
  async complete(request, context) {
    checkDeadline(context);
    const task = { mapping: 'autofill.map-fields', options: 'autofill.match-options' }[context.aiPhase];
    if (!task || !context.principal?.id) throw new ServiceError('invalid-ai-context', 'Trusted AI context required', 500);
    const result = await aiGateway.run({
      task,
      input: request.data,
      userId: context.principal.id,
      requestId: context.requestId,
      runId: context.runId,
      signal: context.signal,
      deadlineAt: context.deadlineAt,
      maxResponseBytes: 128 * 1024,
      redirect: 'error',
      messages: [{ role: 'system', content: request.system }, { role: 'user', content: JSON.stringify(request.data) }],
    });
    checkDeadline(context);
    return JSON.stringify(result.data);
  },
});

module.exports = { createGatewayAiProvider };
