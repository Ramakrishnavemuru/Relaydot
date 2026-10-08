import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, LockKeyhole, MessageCircle, ShieldCheck } from 'lucide-react'
import { useAuth } from '../store'
import { api } from '../api'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, verify2fa, otpLogin, passkeyLogin } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  const [otpMode, setOtpMode] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [demoOtp, setDemoOtp] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true); setError('')
    try {
      if (ticket) await verify2fa(ticket, code)
      else if (otpMode) {
        if (!otpSent) { const result = await api<{ demo_otp?: string }>('/auth/otp/send', { method: 'POST', body: { identifier, purpose: 'LOGIN' } }); setDemoOtp(result.demo_otp || ''); setOtpSent(true); return }
        const result = await otpLogin(identifier, code)
        if (result.ticket) { setTicket(result.ticket); setDemoOtp(result.demo_code || ''); setCode(''); return }
      }
      else {
        const result = await login(identifier, password)
        if (result.ticket) { setTicket(result.ticket); setDemoOtp(result.demo_code || ''); return }
      }
      navigate((location.state as { from?: string } | null)?.from || '/', { replace: true })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in.') }
    finally { setPending(false) }
  }
  return <div className="auth-layout">
    <div className="auth-art"><Link className="wordmark" to="/">relay<span>.</span></Link><div className="auth-message"><div className="auth-glyph"><MessageCircle size={38} /></div><p className="eyebrow">YOUR PEOPLE, ALL IN ONE PLACE</p><h1>A little closer.<br /><span>A lot more connected.</span></h1><p>Messages, ideas, and moments worth sharing.</p></div><div className="auth-art-foot"><span>01 / Connect</span><span>02 / Share</span><span>03 / Belong</span></div></div>
    <div className="auth-panel"><div className="auth-card"><div className="auth-mobile-brand wordmark">relay<span>.</span></div><span className="auth-kicker"><ShieldCheck size={16} /> SECURE SIGN IN</span><h2>{ticket ? 'One more step.' : otpMode ? 'Sign in with a code.' : 'Welcome back.'}</h2><p>{ticket || otpSent ? 'Enter your verification code to continue.' : 'Sign in to pick up where you left off.'}</p><form onSubmit={event => void submit(event)}>
      {!ticket && <><label htmlFor="identifier">{otpMode ? 'Email or phone' : 'Email, username, or phone'}</label><input id="identifier" autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} required placeholder="Your account" /></>}{!ticket && !otpMode && <><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required placeholder="Your password" /></>}{(ticket || otpSent) && <><label htmlFor="code">Verification code</label><input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} required placeholder="Enter your code" />{demoOtp && <p className="muted">Demo code: {demoOtp}</p>}</>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="button primary auth-submit" disabled={pending}>{pending ? 'Signing in…' : ticket || otpSent ? 'Verify and continue' : otpMode ? 'Send one-time code' : 'Sign in'} <ArrowRight size={18} /></button>
    </form><p className="auth-help"><LockKeyhole size={15} /> Your session stays private on this device.</p><div className="auth-divider" /><p className="auth-links"><Link to="/forgot-password">Forgot password?</Link></p><p className="auth-links">New to Relay? <Link to="/register">Create an account</Link></p><p className="auth-links"><button className="text-button" onClick={() => { setOtpMode(!otpMode); setOtpSent(false); setError('') }}>{otpMode ? 'Use password' : 'Use a one-time code'}</button></p><p className="auth-links"><button className="text-button" disabled={pending} onClick={() => { setPending(true); setError(''); void passkeyLogin(identifier).then(() => navigate('/', { replace: true })).catch((cause: Error) => setError(cause.message)).finally(() => setPending(false)) }}>Sign in with passkey</button></p></div></div>
  </div>
}
