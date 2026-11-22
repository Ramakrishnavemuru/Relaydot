import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { api } from '../api'

const genericMessage = 'If an eligible account exists for this email, password reset instructions will be sent.'

function takeToken(): string {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
  if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname)
  return token
}

export function StaffRecoveryPage({ reset = false }: { reset?: boolean }) {
  const [token] = useState(() => reset ? takeToken() : '')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (reset && password !== confirmation) { setError('Passwords do not match.'); return }
    setPending(true)
    try {
      if (reset) {
        await api('/staff/auth/recovery/reset', { method: 'POST', body: {
          token, totp_code: code, new_password: password, confirm_password: confirmation,
        } })
      } else {
        await api('/staff/auth/recovery/request', { method: 'POST', body: { email } })
      }
      setDone(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete recovery. Please try again.')
    } finally { setPending(false) }
  }

  return <div className="auth-layout">
    <div className="auth-art"><Link className="wordmark" to="/">relay<span>.</span></Link><div className="auth-message"><span className="auth-kicker"><ShieldCheck size={17} /> STAFF ACCESS</span><h1>Find your way<br /><span>back in.</span></h1><p>Recover your staff account with your registered email and authenticator app.</p></div></div>
    <div className="auth-panel"><div className="auth-card"><div className="auth-mobile-brand wordmark">relay<span>.</span></div><span className="auth-kicker"><LockKeyhole size={16} /> ACCOUNT RECOVERY</span><h2>{reset ? 'Set a new password.' : 'Forgot your password?'}</h2>
      <p>{reset ? 'Enter the current code from your enrolled authenticator app.' : 'We will send a secure link to your registered staff email.'}</p>
      {done ? <div role="status"><p>{reset ? 'Password changed. All existing sessions have been signed out.' : genericMessage}</p><p className="auth-links"><Link to="/staff/login">Back to Staff Login</Link></p></div> : reset && !token ? <div role="alert"><p>This recovery link is missing or invalid. Request a new link.</p><p className="auth-links"><Link to="/staff/forgot-password">Request reset link</Link></p></div> : <form onSubmit={event => void submit(event)}>
        {!reset ? <><label htmlFor="staff-recovery-email">Registered email</label><input id="staff-recovery-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="you@example.com" /></> : <>
          <label htmlFor="staff-recovery-totp">Authenticator code</label><input id="staff-recovery-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required placeholder="6-digit code" />
          <label htmlFor="staff-recovery-password">New password</label><div className="password-field"><input id="staff-recovery-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} required placeholder="At least 12 characters" /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          <label htmlFor="staff-recovery-confirm">Confirm new password</label><input id="staff-recovery-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={72} value={confirmation} onChange={event => setConfirmation(event.target.value)} required />
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary auth-submit" disabled={pending}>{pending ? 'Please wait…' : reset ? 'Change password' : 'Send Reset Link'}</button>
      </form>}
      {!done && <p className="auth-links"><Link to="/staff/login">Back to Staff Login</Link></p>}
    </div></div>
  </div>
}
