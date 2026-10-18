const { validateResumeContext } = require('@job-assistant/autofill-contracts');
const { ServiceError, checkDeadline } = require('../errors');

/**
 * @typedef {{ id: string, email: string }} AuthenticatedPrincipal
 * @typedef {{ principal: AuthenticatedPrincipal, expectedProfileVersion?: string,
 *   signal?: AbortSignal, deadlineAt: number }} ResumeLoadContext
 */

// Prisma does not cancel an in-flight query through AbortSignal. Stop waiting and
// discard late data; do not claim that the database statement itself was cancelled.
const withinDeadline = async (ctx, operation) => {
  checkDeadline(ctx);
  let timer;
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(new ServiceError('deadline-exceeded', 'Operation cancelled or deadline exceeded', 504, true));
    ctx.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(abort, Math.min(ctx.deadlineAt - Date.now(), 2_147_483_647));
  });
  try {
    checkDeadline(ctx);
    return await Promise.race([operation(), stopped]);
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', abort);
  }
};

/**
 * Inject the same profile service used by GET /profiles/me/autofill-context.
 * No HTTP loopback, Prisma import, credentials, fixture fallback, or profile cache.
 * The caller must authenticate first; this is a server-only port, not a route.
 * @param {{ profileService: { getAutofillContext(user: AuthenticatedPrincipal): Promise<unknown> } }} dependencies
 */
const createPlatformResumeClient = ({ profileService }) => ({
  /** @param {ResumeLoadContext} ctx */
  async load(ctx) {
    const { principal } = ctx;
    if (!principal || typeof principal.id !== 'string' || !principal.id.trim() ||
        typeof principal.email !== 'string' || !principal.email.trim()) {
      throw new ServiceError('authentication-required', 'Authenticated account required', 401);
    }
    if (ctx.expectedProfileVersion !== undefined &&
        (typeof ctx.expectedProfileVersion !== 'string' || !/^[a-f\d]{64}$/i.test(ctx.expectedProfileVersion))) {
      throw new ServiceError('invalid-request', 'Invalid expected profile version');
    }
    checkDeadline(ctx);
    let value;
    try {
      const user = { id: principal.id, email: principal.email };
      value = await withinDeadline(ctx, () => profileService.getAutofillContext(user));
    } catch (error) {
      checkDeadline(ctx);
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('resume-api-unavailable', 'Resume source unavailable', 502, true);
    }
    checkDeadline(ctx);
    const checked = validateResumeContext(value);
    if (!checked.ok) throw new ServiceError('resume-api-invalid', 'Invalid resume context', 502);
    if (ctx.expectedProfileVersion && ctx.expectedProfileVersion !== checked.value.profileVersion) {
      throw new ServiceError('resume-version-changed', 'Resume changed; restart this run', 409);
    }
    return checked.value;
  },
});

module.exports = { createPlatformResumeClient };
