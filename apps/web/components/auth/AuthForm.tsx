'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '../../lib/api-client';

type AuthResult = {
  resetToken?: string;
  user?: { emailVerified?: boolean };
};

const nextPath = () => {
  if (typeof window === 'undefined') return '/workspace/profile';
  const next = new URLSearchParams(window.location.search).get('next');
  return next?.startsWith('/') ? next : '/workspace/profile';
};

export function AuthForm({ mode }: { mode: 'login' | 'register' | 'forgot' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const path = mode === 'login' ? '/auth/login' : mode === 'register' ? '/auth/register' : '/auth/forgot-password';
      const result = await apiRequest<AuthResult>(path, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (mode === 'forgot') {
        setMessage(result.resetToken ? '本地测试重置令牌：' + result.resetToken : '如果邮箱存在，重置链接将发送到邮箱。');
        return;
      }

      const destination = nextPath();
      if (result.user?.emailVerified === false) {
        router.replace('/verify-email?email=' + encodeURIComponent(email) + '&next=' + encodeURIComponent(destination));
        return;
      }
      router.replace(destination);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '请求失败，请稍后再试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        邮箱
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="name@example.com" />
      </label>
      {mode !== 'forgot' && (
        <label>
          密码
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} placeholder="至少 8 位" />
        </label>
      )}
      <button type="submit" disabled={loading}>
        {loading ? '处理中…' : mode === 'login' ? '登录' : mode === 'register' ? '创建账户' : '发送重置邮件'}
      </button>
      {message && <p>{message}</p>}
    </form>
  );
}
