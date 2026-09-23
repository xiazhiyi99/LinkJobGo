'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api-client';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { const value = new URLSearchParams(window.location.search).get('token'); if (value) setToken(value); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage('');
    try { await apiRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }); setDone(true); setMessage('密码已重置，请重新登录。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '重置失败，请稍后再试。'); }
  };
  return <main className="auth-page"><div className="auth-card"><Link className="auth-brand" href="/">领客<span>.</span></Link><h1>重置密码</h1>{done ? <p>{message} <Link href="/login">去登录</Link></p> : <form className="auth-form" onSubmit={submit}><label>重置令牌<input value={token} onChange={(e) => setToken(e.target.value)} required placeholder="粘贴邮件中的令牌" /></label><label>新密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required placeholder="至少 8 位" /></label><button type="submit">保存新密码</button>{message && <p>{message}</p>}</form>}<div className="auth-links"><Link href="/login">返回登录</Link></div></div></main>;
}
