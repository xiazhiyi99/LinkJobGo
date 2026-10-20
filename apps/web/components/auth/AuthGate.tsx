'use client';

import { Fragment, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAccountSession } from './AccountProvider';

export const useAccount = () => useAccountSession().account;

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { account, status, error, refresh } = useAccountSession();

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);
  useEffect(() => {
    if (status !== 'ready' || account) return;
    router.replace((error?.code === 'EMAIL_NOT_VERIFIED' ? '/verify-email?next=' : '/login?next=') + encodeURIComponent(pathname));
  }, [account, status, error?.code, pathname, router]);

  if (!account) return <div className="auth-loading" aria-live="polite"><div>{status === 'error' ? <><p>{error?.message}</p><button type="button" onClick={() => void refresh(true)}>重新连接</button></> : status === 'ready' ? '正在进入登录页…' : '正在准备工作台…'}</div></div>;
  return <Fragment key={account.id}>{children}</Fragment>;
}
