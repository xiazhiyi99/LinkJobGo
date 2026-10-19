import type { OperationContext, ReadinessRequest, AnalyzeRequest, PlanRequest } from '@job-assistant/autofill-contracts';
import { PlatformError, type ApiClient, type FillOperation } from './api-client.js';
import { normalizeApiPathPrefix } from './api-prefix.js';

// Cookie is owned by the browser. No password, cookie value or token is read/stored.
export function createAuthService({ apiOrigin, apiPathPrefix = '', api, onAccountChange = () => {} }: {
  apiOrigin: string; apiPathPrefix?: string; api: ApiClient; onAccountChange?: () => void;
}) {
  const backendUrl = apiOrigin + normalizeApiPathPrefix(apiPathPrefix);
  let account: Awaited<ReturnType<ApiClient['account']>> | undefined;
  let generation = 0;
  let initialized = false;
  let sequence = 0;
  const update = (next: typeof account) => {
    if (initialized && next?.id !== account?.id) {
      generation++;
      // Signing in from an empty state must not cancel the request discovering it.
      // Losing or switching an existing identity still aborts its pending work.
      if (account) onAccountChange();
    }
    initialized = true;
    account = next;
  };
  const readStatus = async () => {
    const mine = ++sequence;
    try {
      const next = await api.account({ deadlineAt: Date.now() + 8000 });
      if (mine !== sequence) throw new PlatformError('cancelled');
      update(next);
      return { state: 'authenticated', authenticated: true, role: next.role,
        capabilities: { extensionDebug: next.extensionDebug }, ...(next.extensionDebug ? { backendUrl } : {}) };
    } catch (error) {
      if (mine !== sequence) throw new PlatformError('cancelled');
      // A transport failure is not proof of logout. The popup still hides
      // privileged UI on failure; every fill remains authenticated by server.
      if (!(error instanceof PlatformError) || ![401, 403].includes(error.status)) throw error;
      update(undefined);
      if (error.status !== 401) throw error;
      return { state: 'signed-out', authenticated: false, role: 'user', capabilities: { extensionDebug: false } };
    }
  };
  let statusRequest: ReturnType<typeof readStatus> | undefined;
  return {
    status() {
      // Popup polling and permission checks share one fresh request instead of
      // invalidating successful responses whenever the network takes >5 s.
      if (statusRequest) return statusRequest;
      const request = readStatus(); statusRequest = request;
      void request.finally(() => { if (statusRequest === request) statusRequest = undefined; }).catch(() => {});
      return request;
    },
    async fill(operation: FillOperation, input: ReadinessRequest | AnalyzeRequest | PlanRequest, ctx: OperationContext) {
      if (!account) update(await api.account(ctx));
      const current = account!, mine = generation;
      try {
        // Server compares this id with the actual Cookie principal on every request.
        const result = await api.fill(operation, input, current.id, ctx);
        if (mine !== generation) throw new PlatformError('authentication-required', 401);
        return result;
      } catch (error) {
        if (error instanceof PlatformError && error.status === 401) { sequence++; update(undefined); }
        throw error;
      }
    },
  };
}
