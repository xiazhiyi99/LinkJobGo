'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { apiRequest } from '../../lib/api-client';
import { createAccountSession, initialSession, type AccountIdentity } from '../../features/auth/account-session';
import { setProfileAccount } from '../../features/profile/profile-api';

const SessionContext = createContext<ReturnType<typeof createAccountSession> | null>(null);
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [session] = useState(() => createAccountSession({
    load: async signal => (await apiRequest<{ user: AccountIdentity }>('/auth/me', { signal })).user,
    onAccountChange: account => setProfileAccount(account?.id ?? null),
  }));
  useEffect(() => {
    void session.refresh();
    const refresh = () => { if (document.visibilityState === 'visible') void session.refresh(true); };
    const expired = () => session.accept(null);
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('lingke-session-expired', expired);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('lingke-session-expired', expired); };
  }, [session]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
export function useAccountSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('AccountProvider is required');
  const state = useSyncExternalStore(session.subscribe, session.getState, () => initialSession);
  return { ...state, refresh: session.refresh, accept: session.accept };
}
