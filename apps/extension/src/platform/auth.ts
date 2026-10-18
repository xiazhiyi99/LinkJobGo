import { normalizeApiPathPrefix } from './api-prefix.js';
import type { OperationContext, ReadinessRequest, AnalyzeRequest, PlanRequest } from '@job-assistant/autofill-contracts';
import { PlatformError, withinBudget, type ApiClient, type FillOperation } from './api-client.js';
import { validSession, type TokenStore, type Session } from './token-store.js';

export function createAuthService({ apiOrigin, apiPathPrefix = '', api, store, onAccountChange = () => {} }: { apiOrigin: string; apiPathPrefix?: string; api: ApiClient; store: TokenStore; onAccountChange?: () => void }) {
  apiPathPrefix = normalizeApiPathPrefix(apiPathPrefix);
  const sameEndpoint = (session?: Session) => !!session && session.apiOrigin === apiOrigin && (session.apiPathPrefix ?? '') === apiPathPrefix;
  let generation = 0;
  let loginController: AbortController | undefined;
  const usable = (session?: Session) => !!session && sameEndpoint(session) && !session.needsLogin && session.expiresAt > Date.now();
  return {
    async status() {
      const { session } = await store.read();
      const state = !session ? 'signed-out' : usable(session) ? 'authenticated' : 'needs-login';
      return { backendUrl: apiOrigin + apiPathPrefix, state, authenticated: state === 'authenticated', ...(sameEndpoint(session) ? { email: session!.user.email, expiresAt: session!.expiresAt } : {}) };
    },
    async login(email: string, password: string) {
      if (typeof email !== 'string' || !email.trim() || email.length > 320 || typeof password !== 'string' || !password || password.length > 4096) throw new PlatformError('invalid-credentials');
      const mine = ++generation;
      loginController?.abort(); onAccountChange();
      const controller = new AbortController(); loginController = controller;
      const ctx = { signal: controller.signal, deadlineAt: Date.now() + 20_000 };
      try {
        await withinBudget(ctx, async signal => {
          const before = await store.read();
          if (signal.aborted || mine !== generation) throw new PlatformError('cancelled');
          const value = await api.login(email.trim(), password, { ...ctx, signal });
          const session = { apiOrigin, apiPathPrefix, accessToken: value?.accessToken, expiresAt: Date.now() + value?.expiresIn * 1000, user: { id: value?.user?.id, email: value?.user?.email, emailVerified: value?.user?.emailVerified } };
          if (!validSession(session) || !Number.isFinite(value.expiresIn) || value.expiresIn <= 0 || value.expiresIn > 86400) throw new PlatformError('backend-invalid-response');
          if (signal.aborted || mine !== generation || !(await store.update(before.revision, session))) throw new PlatformError('cancelled');
        });
      } catch (error) {
        if (error instanceof PlatformError && error.status === 401) throw new PlatformError('invalid-credentials', 401);
        throw error;
      } finally { if (loginController === controller) loginController = undefined; }
      return { ok: true };
    },
    async logout() {
      ++generation; loginController?.abort(); onAccountChange();
      const previous = await store.clear();
      if (!previous.session || !sameEndpoint(previous.session)) return { ok: true, serverRevoked: false };
      try {
        await api.logout(previous.session.accessToken, { deadlineAt: Date.now() + 5000 });
        // The current API cannot revoke an already expired access token.
        return { ok: true, serverRevoked: previous.session.expiresAt > Date.now() };
      } catch { return { ok: true, serverRevoked: false }; }
    },
    async fill(operation: FillOperation, input: ReadinessRequest | AnalyzeRequest | PlanRequest, ctx: OperationContext) {
      if (loginController) throw new PlatformError('authentication-required', 401);
      return withinBudget(ctx, async signal => {
        const saved = await store.read();
        if (!usable(saved.session)) throw new PlatformError('authentication-required', 401);
        try {
          const result = await api.fill(operation, input, saved.session!.accessToken, { ...ctx, signal });
          const current = await store.read();
          if (saved.revision !== current.revision) throw new PlatformError('authentication-required', 401);
          return result;
        } catch (error) {
          if (error instanceof PlatformError && error.status === 401) await store.update(saved.revision, { ...saved.session!, needsLogin: true });
          throw error;
        }
      });
    },
  };
}
