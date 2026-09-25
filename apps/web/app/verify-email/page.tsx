'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api-client';

export default function VerifyEmailPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [next, setNext] = useState('/workspace/profile');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'verified'>('idle');
  const [loading, setLoading] = useState(false);
  const verifiedToken = useRef<string | null>(null);

  const verify = async (value = token, destination = next) => {
    if (!value) {
      setMessage('请打开邮件中的验证链接，或粘贴验证令牌。');
      return;
    }
    setLoading(true);
    setStatus('verifying');
    setMessage('');
    try {
      await apiRequest('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: value }) });
      setStatus('verified');
      try {
        await apiRequest('/auth/me');
        router.replace(destination);
      } catch {
        router.replace('/login?verified=1&next=' + encodeURIComponent(destination));
      }
    } catch (error) {
      setStatus('idle');
      setMessage(error instanceof Error ? error.message : '验证失败，请稍后再试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('token') || '';
    const address = params.get('email') || '';
    const destination = params.get('next');
    setToken(value);
    setEmail(address);
    if (destination?.startsWith('/')) setNext(destination);
    if (value && verifiedToken.current !== value) {
      verifiedToken.current = value;
      void verify(value, destination?.startsWith('/') ? destination : '/workspace/profile');
    }
  }, []);

  const resend = async () => {
    if (!email) {
      setMessage('请先填写注册邮箱。');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const result = await apiRequest<{ message: string }>('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setMessage(result.message || '如果邮箱存在，验证链接将发送到邮箱。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发送失败，请稍后再试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Link className="auth-brand" href="/">领客<span>.</span></Link>
        <h1>验证邮箱</h1>
        <p>{status === 'verified' ? '邮箱已验证，正在进入下一步。' : '请点击邮件中的验证链接完成注册。'}</p>
        {status !== 'verified' && (
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void verify(); }}>
            <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
            <label>验证令牌<input value={token} onChange={(event) => setToken(event.target.value)} placeholder="也可以粘贴邮件中的令牌" /></label>
            <button type="submit" disabled={loading}>{loading && status === 'verifying' ? '验证中…' : '验证邮箱'}</button>
            <button type="button" className="auth-secondary-button" onClick={() => void resend()} disabled={loading}>重新发送验证邮件</button>
            {message && <p>{message}</p>}
          </form>
        )}
        <div className="auth-links"><Link href="/login">返回登录</Link></div>
      </div>
    </main>
  );
}
