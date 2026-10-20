export type AccountIdentity = { id: string; email: string; role: 'admin' | 'user'; emailVerified?: boolean };
export type SessionState = { account: AccountIdentity | null; status: 'loading' | 'ready' | 'error'; error: { message: string; code?: string } | null };
export const initialSession: SessionState = { account: null, status: 'loading', error: null };

/** Short-lived client state for navigation; API authorization remains authoritative. */
export function createAccountSession({ load, onAccountChange = () => {}, now = Date.now }: {
  load(signal: AbortSignal): Promise<AccountIdentity>;
  onAccountChange?(account: AccountIdentity | null): void;
  now?: () => number;
}) {
  let state = initialSession, checkedAt = -Infinity, generation = 0;
  let pending: Promise<void> | undefined, controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SessionState) => {
    if (next.account?.id !== state.account?.id) onAccountChange(next.account);
    state = next; for (const listener of listeners) listener();
  };
  const accept = (account: AccountIdentity | null) => {
    generation++; controller?.abort(); pending = undefined;
    checkedAt = now(); publish({ account, status: 'ready', error: null });
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    accept,
    refresh(force = false): Promise<void> {
      if (pending) return pending;
      if (!force && now() - checkedAt < (state.status === 'error' ? 5000 : 30_000)) return Promise.resolve();
      const mine = ++generation;
      controller = new AbortController();
      const requestController = controller;
      const timer = setTimeout(() => requestController.abort(), 10_000);
      const request = (async () => {
        try {
          const account = await load(requestController.signal);
          if (!account?.id || !account.email || !['admin', 'user'].includes(account.role)) throw new Error('登录状态响应无效，请重试。');
          if (mine === generation) publish({ account, status: 'ready', error: null });
        } catch (caught) {
          if (mine !== generation) return;
          const error = caught as { status?: number; message?: string; payload?: { code?: string } };
          const anonymous = error.status === 401 || error.payload?.code === 'EMAIL_NOT_VERIFIED';
          publish({ account: anonymous ? null : state.account, status: anonymous ? 'ready' : 'error', error: { message: error.message || '暂时无法检查登录状态，请重试。', code: error.payload?.code } });
        } finally {
          clearTimeout(timer);
          if (mine === generation) { checkedAt = now(); pending = undefined; }
        }
      })();
      pending = request;
      return request;
    },
  };
}
