'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiRequest } from '../../lib/api-client';

interface AccountIdentity { id: string; email: string; role: 'admin' | 'user' }
const AccountContext = createContext<AccountIdentity | null>(null);
export const useAccount = () => useContext(AccountContext);

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [account, setAccount] = useState<AccountIdentity | null>(null);
  const [validatedPath, setValidatedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ user: AccountIdentity }>('/auth/me')
      .then(({ user }) => { if (!user?.id) throw new Error('Invalid account'); if (!cancelled) { setAccount(user); setValidatedPath(pathname); } })
      .catch((error: { payload?: { code?: string } }) => {
        if (cancelled) return;
        setAccount(null); setValidatedPath(null);
        if (error.payload?.code === 'EMAIL_NOT_VERIFIED') router.replace('/verify-email?next=' + encodeURIComponent(pathname));
        else router.replace('/login?next=' + encodeURIComponent(pathname));
      });
    return () => { cancelled = true; };
  }, [pathname, router]);

  if (!account || validatedPath !== pathname) return <div className="auth-loading" aria-live="polite">正在检查登录状态…</div>;
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}
