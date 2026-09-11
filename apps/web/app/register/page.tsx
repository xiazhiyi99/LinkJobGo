import Link from 'next/link'; import { AuthForm } from '../../components/auth/AuthForm';
export default function Register(){return <main className="auth-page"><div className="auth-card"><Link className="auth-brand" href="/">领客<span>.</span></Link><h1>创建账户</h1><AuthForm mode="register"/><div className="auth-links"><Link href="/login">已有账户？登录</Link></div></div></main>}
