'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '../../lib/api-client';
import { CaptchaChallenge, CaptchaPayload } from './CaptchaChallenge';

type AuthResult = {
  resetToken?: string;
  message?: string;
  debugCode?: string;
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
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'error' | 'success'>('error');
  const [loading, setLoading] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (codeCooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCodeCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  const requestEmailCode = async (captcha: CaptchaPayload) => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setMessageKind('error');
      setMessage('请先填写邮箱。');
      return;
    }
    setMessage('');
    try {
      const result = await apiRequest<AuthResult>('/auth/email-code', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail, captcha }),
      });
      setCodeCooldown(60);
      setMessageKind('success');
      setMessage(result.debugCode ? `验证码已发送（本地测试：${result.debugCode}）` : (result.message || '验证码已发送，请查收邮件。'));
    } catch (error) {
      setMessageKind('error');
      setMessage(error instanceof Error ? error.message : '验证码发送失败，请稍后再试。');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      if (mode === 'register') {
        if (password !== passwordConfirmation) {
          setMessageKind('error');
          setMessage('两次输入的密码不一致。');
          return;
        }
        if (!/^\d{6}$/.test(emailCode)) {
          setMessageKind('error');
          setMessage('请输入 6 位邮箱验证码。');
          return;
        }
      }

      const path = mode === 'login' ? '/auth/login' : mode === 'register' ? '/auth/register' : '/auth/forgot-password';
      const body = mode === 'register'
        ? { email: email.trim(), password, passwordConfirmation, emailCode }
        : { email: email.trim(), ...(mode === 'login' ? { password } : {}) };
      const result = await apiRequest<AuthResult>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (mode === 'forgot') {
        setMessageKind('success');
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
      setMessageKind('error');
      setMessage(error instanceof Error ? error.message : '请求失败，请稍后再试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        邮箱
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="name@example.com" autoComplete="email" />
      </label>
      {mode !== 'forgot' && (
        <label>
          密码
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} placeholder="至少 8 位" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
      )}
      {mode === 'register' && (
        <>
          <label>
            重新输入密码
            <input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required minLength={8} placeholder="再次输入密码" autoComplete="new-password" />
          </label>
          <label>
            邮箱验证码
            <div className="auth-code-row">
              <input className="auth-code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ''))} required placeholder="6 位验证码" autoComplete="one-time-code" />
              <CaptchaChallenge disabled={loading || codeCooldown > 0 || !email.trim()} onVerified={requestEmailCode} />
            </div>
            {codeCooldown > 0 && <span className="auth-code-hint">{codeCooldown} 秒后可重新发送</span>}
          </label>
        </>
      )}
      <button type="submit" disabled={loading}>
        {loading ? '处理中…' : mode === 'login' ? '登录' : mode === 'register' ? '创建账户' : '发送重置邮件'}
      </button>
      {message && <p className={messageKind === 'success' ? 'auth-message-success' : undefined} role="status">{message}</p>}
    </form>
  );
}
