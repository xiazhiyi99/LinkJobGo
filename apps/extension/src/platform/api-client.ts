import { normalizeApiPathPrefix } from './api-prefix.js';
import type { ApiResult, OperationContext, ReadinessRequest, AnalyzeRequest, PlanRequest } from '@job-assistant/autofill-contracts';
export type FillOperation = 'readiness' | 'analyze' | 'plan';
export class PlatformError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
const routes = { readiness: '/autofill/v2/readiness', analyze: '/autofill/v2/analyze', plan: '/autofill/v2/plan' } as const;
export async function withinBudget<T>(ctx: OperationContext, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const remaining = ctx.deadlineAt - Date.now();
  if (ctx.signal?.aborted) throw new PlatformError('cancelled');
  if (!Number.isFinite(remaining) || remaining <= 0) throw new PlatformError('deadline-exceeded');
  const controller = new AbortController();
  let rejectAbort!: (reason: PlatformError) => void;
  const stopped = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = () => { controller.abort(); rejectAbort(new PlatformError(Date.now() >= ctx.deadlineAt ? 'deadline-exceeded' : 'cancelled')); };
  ctx.signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, Math.min(remaining, 2_147_483_647));
  try { return await Promise.race([work(controller.signal), stopped]); }
  finally { clearTimeout(timer); ctx.signal?.removeEventListener('abort', stop); controller.abort(); }
}

export function createApiClient({ apiOrigin, apiPathPrefix = '', fetcher = fetch }: { apiOrigin: string; apiPathPrefix?: string; fetcher?: typeof fetch }) {
  const apiBaseUrl = apiOrigin + normalizeApiPathPrefix(apiPathPrefix);
  const request = (path: string, input: unknown, accountId: string | undefined, ctx: OperationContext, maxResponseBytes: number, method = 'POST') => withinBudget(ctx, async signal => {
    try {
      const body = method === 'GET' ? undefined : JSON.stringify(input);
      if (new TextEncoder().encode(body).length > 512 * 1024) throw new PlatformError('request-too-large');
      const response = await fetcher(apiBaseUrl + path, { method, redirect: 'error', credentials: 'include', cache: 'no-store', signal, headers: { 'content-type': 'application/json', ...(accountId ? { 'x-autofill-account-id': accountId } : {}) }, body });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new PlatformError(response.status === 401 ? 'authentication-required' : 'access-denied', response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new PlatformError('backend-invalid-response');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > maxResponseBytes) { await reader.cancel(); throw new PlatformError('backend-response-too-large'); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let value: any;
      try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PlatformError('backend-invalid-response'); }
      return { response, value };
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      throw new PlatformError(signal.aborted ? Date.now() >= ctx.deadlineAt ? 'deadline-exceeded' : 'cancelled' : 'backend-unavailable');
    }
  });
  return {
    async account(ctx: OperationContext) {
      const { response, value } = await request('/auth/me', undefined, undefined, ctx, 64 * 1024, 'GET');
      if (!response.ok) throw new PlatformError('backend-unavailable', response.status);
      const user = value?.user;
      if (!user || typeof user.id !== 'string' || !user.id || typeof user.email !== 'string' || typeof user.emailVerified !== 'boolean') throw new PlatformError('backend-invalid-response');
      return { id: user.id, role: user.role === 'admin' ? 'admin' as const : 'user' as const,
        extensionDebug: user.role === 'admin' && user.capabilities?.extensionDebug === true };
    },
    async fill(operation: FillOperation, input: ReadinessRequest | AnalyzeRequest | PlanRequest, accountId: string, ctx: OperationContext): Promise<ApiResult<unknown>> {
      if (!Object.hasOwn(routes, operation)) throw new PlatformError('invalid-message');
      const { response, value } = await request(routes[operation], { ...input, deadlineAt: ctx.deadlineAt }, accountId, ctx, 1024 * 1024);
      if (!value || typeof value.ok !== 'boolean' || value.requestId !== input.requestId || (!response.ok && value.ok)) throw new PlatformError('backend-invalid-response');
      if (value.ok) {
        if (!Object.hasOwn(value, 'data')) throw new PlatformError('backend-invalid-response');
        return { ok: true, requestId: value.requestId, data: value.data };
      }
      if (!value.error || typeof value.error.code !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.error.code) || typeof value.error.retryable !== 'boolean') throw new PlatformError('backend-invalid-response');
      return { ok: false, requestId: value.requestId, error: { code: value.error.code, message: value.error.code, retryable: value.error.retryable } };
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
