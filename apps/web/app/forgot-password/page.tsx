import Link from 'next/link'; import { AuthForm } from '../../components/auth/AuthForm';
export default function Forgot(){return <main className="auth-page"><div className="auth-card"><Link className="auth-brand" href="/">领客<span>.</span></Link><h1>找回密码</h1><AuthForm mode="forgot"/><div className="auth-links"><Link href="/login">返回登录</Link></div></div></main>}
