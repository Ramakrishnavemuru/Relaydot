import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [demoCode, setDemoCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try {
      if (!sent) { const result = await api<{ demo_code?: string }>('/auth/forgot-password', { method: 'POST', body: { email } }); setDemoCode(result.demo_code || ''); setSent(true) }
      else { await api('/auth/reset-password', { method: 'POST', body: { email, reset_code: code, new_password: password, confirm_new_password: password } }); setDone(true) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reset password.') }
    finally { setPending(false) }
  }
  return <div className="auth-layout"><div className="auth-art"><Link className="wordmark" to="/">relay<span>.</span></Link><div className="auth-message"><h1>Welcome back.</h1><p>Recover your account securely.</p></div></div><div className="auth-panel"><div className="auth-card"><h2>Reset password</h2>{done ? <p>Password updated. <Link to="/login">Sign in</Link></p> : <form onSubmit={event => void submit(event)}><label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>{sent && <><label>Reset code<input value={code} onChange={event => setCode(event.target.value)} required /></label><label>New password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={6} /></label>{demoCode && <p className="muted">Demo code: {demoCode}</p>}</>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary auth-submit" disabled={pending}>{pending ? 'Please wait…' : sent ? 'Reset password' : 'Send reset code'}</button></form>}<p className="auth-links"><Link to="/login">Back to sign in</Link></p></div></div></div>
}
