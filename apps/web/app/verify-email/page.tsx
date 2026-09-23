'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api-client';

export default function VerifyEmailPage() {
  const [token, setToken] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { const value = new URLSearchParams(window.location.search).get('token'); if (value) setToken(value); }, []);
  const verify = async () => { setMessage(''); try { await apiRequest('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }); setMessage('邮箱验证成功，请返回工作台。'); } catch (error) { setMessage(error instanceof Error ? error.message : '验证失败，请稍后再试。'); } };
  return <main className="auth-page"><div className="auth-card"><Link className="auth-brand" href="/">领客<span>.</span></Link><h1>验证邮箱</h1><p>请输入邮件中的验证令牌。</p><form className="auth-form" onSubmit={(event) => { event.preventDefault(); void verify(); }}><label>验证令牌<input value={token} onChange={(e) => setToken(e.target.value)} required /></label><button type="submit">验证邮箱</button>{message && <p>{message}</p>}</form><div className="auth-links"><Link href="/login">返回登录</Link></div></div></main>;
}
