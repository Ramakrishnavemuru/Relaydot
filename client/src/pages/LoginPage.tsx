import { FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, LockKeyhole, MessageCircle, ShieldCheck } from 'lucide-react'
import { useAuth } from '../store'
import { api } from '../api'

export function LoginPage({ staff = false }: { staff?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, verify2fa, staffLogin, staffVerify2fa, otpLogin, passkeyLogin } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  const [otpMode, setOtpMode] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [demoOtp, setDemoOtp] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    // WebAuthn credentials for localhost cannot be used on the 127.0.0.1 IP origin.
    if (window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1') {
      const canonical = new URL(window.location.href)
      canonical.hostname = 'localhost'
      window.location.replace(canonical.href)
    }
  }, [])
  const signInWithPasskey = async () => {
    if (staff && !identifier.trim()) { setError('Enter your staff username, email, or phone before using a passkey.'); return }
    setPending(true); setError('')
    try { await passkeyLogin(identifier, staff); navigate(staff ? '/staff/dashboard' : '/', { replace: true }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Passkey sign-in failed.') }
    finally { setPending(false) }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true); setError('')
    try {
      if (ticket) await (staff ? staffVerify2fa(ticket, code) : verify2fa(ticket, code))
      else if (otpMode) {
        if (!otpSent) { const result = await api<{ demo_otp?: string }>('/auth/otp/send', { method: 'POST', body: { identifier, purpose: 'LOGIN' } }); setDemoOtp(result.demo_otp || ''); setOtpSent(true); return }
        const result = await otpLogin(identifier, code)
        if (result.ticket) { setTicket(result.ticket); setDemoOtp(result.demo_code || ''); setCode(''); return }
      }
      else {
        const result = await (staff ? staffLogin(identifier, password) : login(identifier, password))
        if (result.ticket) { setTicket(result.ticket); setDemoOtp(staff ? '' : (result as { demo_code?: string }).demo_code || ''); return }
      }
      navigate(staff ? '/staff/dashboard' : (location.state as { from?: string } | null)?.from || '/', { replace: true })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in.') }
    finally { setPending(false) }
  }
  return <div className="auth-layout">
    <div className="auth-art"><Link className="wordmark" to="/">relay<span>.</span></Link><div className="auth-message"><div className="auth-glyph"><MessageCircle size={28} /></div><p className="eyebrow">RELAYDOT</p><h1>People, posts,<br /><span>and conversations.</span></h1><p>Sign in to continue where you left off.</p></div><div className="auth-art-foot"><span>Messages</span><span>Posts</span><span>Communities</span></div></div>
    <div className="auth-panel"><div className="auth-card"><div className="auth-mobile-brand wordmark">relay<span>.</span></div><span className="auth-kicker"><ShieldCheck size={16} /> {staff ? 'STAFF ACCESS' : 'SECURE SIGN IN'}</span><h2>{ticket ? 'One more step.' : otpMode ? 'Sign in with a code.' : staff ? 'Relaydot staff.' : 'Welcome back.'}</h2><p>{staff ? 'Use your staff account and authenticator. Privileged access lasts 30 minutes.' : ticket || otpSent ? 'Enter your verification code to continue.' : 'Sign in to pick up where you left off.'}</p><form onSubmit={event => void submit(event)}>
      {!ticket && <><label htmlFor="identifier">{otpMode ? 'Email or phone' : 'Email, username, or phone'}</label><input id="identifier" autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} required placeholder="Your account" /></>}{!ticket && !otpMode && <><label htmlFor="password">Password</label><div className="password-field"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required placeholder="Your password" /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></>}{(ticket || otpSent) && <><label htmlFor="code">Verification code</label><input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} required placeholder="Enter your code" />{demoOtp && <p className="muted">Demo code: {demoOtp}</p>}</>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="button primary auth-submit" disabled={pending}>{pending ? 'Signing in…' : ticket || otpSent ? 'Verify and continue' : otpMode ? 'Send one-time code' : 'Sign in'} <ArrowRight size={18} /></button>
    </form><p className="auth-help"><LockKeyhole size={15} /> Your session stays private on this device.</p><div className="auth-divider" /><p className="auth-links"><Link to={staff ? '/staff/forgot-password' : '/forgot-password'}>Forgot password?</Link></p>{staff && <p className="auth-links"><Link to="/login">Back to Relaydot</Link></p>}{!staff && <><p className="auth-links">New to Relay? <Link to="/register">Create an account</Link></p><p className="auth-links"><button className="text-button" onClick={() => { setOtpMode(!otpMode); setOtpSent(false); setError('') }}>{otpMode ? 'Use password' : 'Use a one-time code'}</button></p></>}<p className="auth-links"><button type="button" className="text-button" disabled={pending} onClick={() => void signInWithPasskey()}>Sign in with passkey</button></p>{staff && <p className="auth-passkey-hint">Add a passkey in Settings after signing in with your staff account and authenticator.</p>}</div></div>
  </div>
}
