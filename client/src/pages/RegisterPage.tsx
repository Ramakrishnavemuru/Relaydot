import { FormEvent, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, MessageCircle, ShieldCheck } from 'lucide-react'
import { useAuth } from '../store'

export function RegisterPage() {
  const register = useAuth(state => state.register)
  const verifyRegistrationOtp = useAuth(state => state.verifyRegistrationOtp)
  const navigate = useNavigate()
  const [form, setForm] = useState({ display_name: '', username: '', email: '', password: '', confirm_password: '' })
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [verification, setVerification] = useState<{ identifier: string; demo_otp?: string } | null>(null)
  const [code, setCode] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!verification && form.password !== form.confirm_password) { setError('Passwords do not match.'); return }
    setPending(true)
    try {
      if (verification) { await verifyRegistrationOtp(verification.identifier, code); navigate('/', { replace: true }) }
      else { const result = await register(form); if (result.requires_otp) setVerification({ identifier: result.identifier || form.email, demo_otp: result.demo_otp }); else navigate('/', { replace: true }) }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create your account.') }
    finally { setPending(false) }
  }
  const update = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement>) => setForm(previous => ({ ...previous, [key]: event.target.value }))
  return <div className="auth-layout"><div className="auth-art"><Link className="wordmark" to="/">relay<span>.</span></Link><div className="auth-message"><div className="auth-glyph"><MessageCircle size={38} /></div><p className="eyebrow">A BETTER SPACE TO CONNECT</p><h1>Find your people.<br /><span>Share your world.</span></h1><p>Make room for conversations that matter.</p></div><div className="auth-art-foot"><span>01 / Connect</span><span>02 / Share</span><span>03 / Belong</span></div></div><div className="auth-panel"><div className="auth-card"><div className="auth-mobile-brand wordmark">relay<span>.</span></div><span className="auth-kicker"><ShieldCheck size={16} /> JOIN RELAY</span><h2>{verification ? 'Verify your account.' : 'Create your account.'}</h2><p>{verification ? `Enter the code sent to ${verification.identifier}.` : 'It only takes a moment to get started.'}</p><form onSubmit={event => void submit(event)}>{verification ? <><label htmlFor="registration-code">Verification code</label><input id="registration-code" value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required />{verification.demo_otp && <p className="muted">Demo code: {verification.demo_otp}</p>}</> : <><label htmlFor="display-name">Display name</label><input id="display-name" value={form.display_name} onChange={update('display_name')} required autoComplete="name" /><label htmlFor="username">Username</label><input id="username" value={form.username} onChange={update('username')} required autoComplete="username" /><label htmlFor="email">Email</label><input id="email" type="email" value={form.email} onChange={update('email')} required autoComplete="email" /><label htmlFor="new-password">Password</label><input id="new-password" type="password" value={form.password} onChange={update('password')} required minLength={8} autoComplete="new-password" /><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" value={form.confirm_password} onChange={update('confirm_password')} required minLength={8} autoComplete="new-password" /></>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary auth-submit" disabled={pending}>{pending ? 'Please wait…' : verification ? 'Verify account' : 'Create account'}<ArrowRight size={18} /></button></form><div className="auth-divider" /><p className="auth-links">Already a member? <Link to="/login">Sign in</Link></p></div></div></div>
}
