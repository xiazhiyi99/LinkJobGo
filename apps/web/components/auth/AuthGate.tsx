'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiRequest } from '../../lib/api-client';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiRequest('/auth/me')
      .then(() => { if (!cancelled) setReady(true); })
      .catch((error: { payload?: { code?: string } }) => {
        if (cancelled) return;
        if (error.payload?.code === 'EMAIL_NOT_VERIFIED') router.replace('/verify-email?next=' + encodeURIComponent(pathname));
        else router.replace('/login?next=' + encodeURIComponent(pathname));
      });
    return () => { cancelled = true; };
  }, [pathname, router]);

  if (!ready) return <div className="auth-loading" aria-live="polite">正在检查登录状态…</div>;
  return <>{children}</>;
}
