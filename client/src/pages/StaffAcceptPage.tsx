import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

export function StaffAcceptPage() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError('')
    try { await api('/staff/moderators/accept', { method: 'POST', body: { token } }); setDone(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invitation could not be accepted.') }
    finally { setPending(false) }
  }
  return <div className="staff-gate"><h1>Join the Relaydot staff team</h1>{done ? <><p>Moderator access is enabled. Sign in again and complete MFA to open the dashboard.</p><Link className="button primary" to="/staff/login">Staff sign in</Link></> : <><p>Use the invitation token provided by the owner. Your account must have a verified email and authenticator MFA.</p><form className="staff-accept" onSubmit={event => void submit(event)}><label>Invitation token<input value={token} onChange={event => setToken(event.target.value)} required /></label>{error && <span role="alert">{error}</span>}<button className="button primary" disabled={pending}>{pending ? 'Joining…' : 'Accept invitation'}</button></form></>}<Link to="/">Back to Relaydot</Link></div>
}
