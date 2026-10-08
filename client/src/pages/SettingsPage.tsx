import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Monitor, Moon, Sun } from 'lucide-react'
import { api } from '../api'
import { ErrorBox, Shell } from '../components'
import { useAuth } from '../store'
import type { User } from '../types'
import { registerPasskey, passkeysSupported } from '../passkeys'
import { useTheme } from '../theme'

type Preferences = User & { email?: string; show_last_seen: boolean; show_online: boolean; show_read_receipts: boolean; totp_enabled: boolean }
type Session = { id?: string; session_id?: string; device_name?: string; user_agent?: string; is_current?: boolean; created_at?: string }
type Passkey = { id: number; name: string; created_at?: string; last_used_at?: string }

export function SettingsPage() {
  const client = useQueryClient()
  const setUser = useAuth(state => state.setUser)
  const theme = useTheme(state => state.preference)
  const setTheme = useTheme(state => state.setPreference)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [password, setPassword] = useState({ current_password: '', new_password: '', confirm_new_password: '' })
  const [totp, setTotp] = useState<{ secret?: string; qr_svg?: string; otpauth_url?: string } | null>(null)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState<string[]>([])
  const me = useQuery({ queryKey: ['settings-me'], queryFn: () => api<Preferences>('/auth/me') })
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<Session[]>('/auth/sessions') })
  const passkeys = useQuery({ queryKey: ['passkeys'], queryFn: () => api<Passkey[]>('/auth/passkeys') })
  const privacy = useMutation({ mutationFn: (body: object) => api<Preferences>('/users/privacy', { method: 'PUT', body }), onSuccess: user => { setUser(user); void client.invalidateQueries({ queryKey: ['settings-me'] }); setNotice('Privacy updated.') }, onError: (cause: Error) => setError(cause.message) })
  const changePassword = useMutation({ mutationFn: () => api('/auth/change-password', { method: 'POST', body: password }), onSuccess: () => { setPassword({ current_password: '', new_password: '', confirm_new_password: '' }); setNotice('Password updated.'); setError('') }, onError: (cause: Error) => setError(cause.message) })
  const revoke = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['sessions'] }), onError: (cause: Error) => setError(cause.message) })
  const enableTotp = useMutation({ mutationFn: () => api<{ recovery_codes: string[] }>('/auth/2fa/totp/enable', { method: 'POST', body: { code } }), onSuccess: data => { setRecovery(data.recovery_codes); setTotp(null); setCode(''); void client.invalidateQueries({ queryKey: ['settings-me'] }) }, onError: (cause: Error) => setError(cause.message) })
  const disableTotp = useMutation({ mutationFn: () => api('/auth/2fa/totp/disable', { method: 'POST', body: { code } }), onSuccess: () => { setCode(''); void client.invalidateQueries({ queryKey: ['settings-me'] }); setNotice('Two-factor authentication disabled.') }, onError: (cause: Error) => setError(cause.message) })
  return <Shell active="Profile"><header className="page-header"><h1>Settings</h1><Link to="/profile">Profile</Link></header>
    <section className="settings-section appearance-section"><h2>Appearance</h2><p>Choose how Relay looks on this device.</p>
      <div className="theme-options" role="radiogroup" aria-label="Appearance">
        {([
          { value: 'system', label: 'System', detail: 'Match your device · default', Icon: Monitor },
          { value: 'light', label: 'Light', detail: 'Bright and clear', Icon: Sun },
          { value: 'dark', label: 'Dark', detail: 'Easy on the eyes', Icon: Moon },
        ] as const).map(({ value, label, detail, Icon }) => <label className={`theme-option${theme === value ? ' selected' : ''}`} key={value}>
          <input type="radio" name="appearance" value={value} checked={theme === value} onChange={() => setTheme(value)} />
          <Icon size={21} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span>
        </label>)}
      </div>
    </section>
    {me.isPending && <div className="loading-list">Loading settings…</div>}{me.error && <ErrorBox error={me.error} />}{notice && <p className="settings-notice" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    {me.data && <><section className="settings-section"><h2>Privacy</h2>{([['show_last_seen', 'Show last seen'], ['show_online', 'Show when online'], ['show_read_receipts', 'Read receipts']] as const).map(([key, label]) => <label className="settings-toggle" key={key}><span>{label}</span><input type="checkbox" checked={!!me.data?.[key]} disabled={privacy.isPending} onChange={event => privacy.mutate({ [key]: event.target.checked })} /></label>)}</section>
    <section className="settings-section"><h2>Change password</h2><form className="profile-edit-form" onSubmit={(event: FormEvent) => { event.preventDefault(); changePassword.mutate() }}><label>Current password<input type="password" value={password.current_password} onChange={event => setPassword({ ...password, current_password: event.target.value })} required /></label><label>New password<input type="password" value={password.new_password} onChange={event => setPassword({ ...password, new_password: event.target.value })} minLength={6} required /></label><label>Confirm new password<input type="password" value={password.confirm_new_password} onChange={event => setPassword({ ...password, confirm_new_password: event.target.value })} minLength={6} required /></label><button className="button primary" disabled={changePassword.isPending}>Update password</button></form></section>
    <section className="settings-section"><h2>Two-factor authentication</h2><p>Protect your account with an authenticator app.</p>{!me.data.totp_enabled && !totp && <button className="button secondary" onClick={() => void api<{ secret: string; qr_svg?: string; otpauth_url?: string }>('/auth/2fa/totp/setup', { method: 'POST' }).then(setTotp).catch((cause: Error) => setError(cause.message))}>Set up two-factor authentication</button>}{totp && <div><p>Add this secret to your authenticator app: <code>{totp.secret}</code></p><label>Verification code<input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" /></label><button className="button primary" onClick={() => enableTotp.mutate()} disabled={!code.trim()}>Enable</button></div>}{me.data.totp_enabled && <div><label>Authenticator or recovery code<input value={code} onChange={event => setCode(event.target.value)} /></label><button className="button secondary" disabled={!code.trim()} onClick={() => disableTotp.mutate()}>Disable two-factor authentication</button></div>}{recovery.length > 0 && <div className="recovery-codes"><strong>Save these recovery codes now:</strong><pre>{recovery.join('\n')}</pre></div>}</section></>}
    <section className="settings-section"><h2>Active sessions</h2>{sessions.error && <ErrorBox error={sessions.error} />}{sessions.data?.map((session, index) => <div className="session-row" key={session.id || session.session_id || index}><span>{session.device_name || session.user_agent || 'Device'}{session.is_current && ' · Current'}</span>{!session.is_current && <button className="button secondary" onClick={() => revoke.mutate(session.session_id || session.id || '')}>Sign out</button>}</div>)}<button className="button secondary" onClick={() => void api('/auth/sessions/revoke-others', { method: 'POST' }).then(() => { setNotice('Other sessions signed out.'); void client.invalidateQueries({ queryKey: ['sessions'] }) }).catch((cause: Error) => setError(cause.message))}>Sign out other devices</button></section>
    <section className="settings-section"><h2>Passkeys</h2>{passkeys.error && <ErrorBox error={passkeys.error} />}{passkeys.data?.map(item => <div className="session-row" key={item.id}><span>{item.name}</span><button className="button secondary" onClick={() => { if (confirm(`Remove passkey ${item.name}?`)) void api(`/auth/passkeys/${item.id}`, { method: 'DELETE' }).then(() => client.invalidateQueries({ queryKey: ['passkeys'] })).catch((cause: Error) => setError(cause.message)) }}>Remove</button></div>)}{passkeysSupported() && <button className="button secondary" onClick={() => { const name = prompt('Name this passkey', 'My Passkey'); if (name != null) void registerPasskey(name).then(() => { setNotice('Passkey added.'); void client.invalidateQueries({ queryKey: ['passkeys'] }) }).catch((cause: Error) => setError(cause.message)) }}>Add passkey</button>}</section>
  </Shell>
}
