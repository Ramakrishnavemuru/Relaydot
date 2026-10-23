import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, ArrowLeft, Bell, Bug, CheckCircle2, ClipboardList, Clock3, FileText, Flag, LayoutDashboard, LifeBuoy, Search, ShieldAlert, ShieldCheck, Users, X } from 'lucide-react'
import { api, query } from '../api'
import { useAuth } from '../store'

type Staff = { id: number; username: string; role: 'MODERATOR' | 'OWNER' }
type Case = { id: number; kind: string; title: string; category: string; description: string; steps?: string; expected?: string; actual?: string; attachment_url?: string; status: string; priority: string; reporter_id: number; assigned_to_id?: number; created_at: string; messages?: { id: number; body: string; internal?: boolean; author_id: number; created_at: string }[] }
type AbuseReport = { id: number; entity_type: string; entity_id: number; reason: string; details?: string; status: string; priority: string; reporter_id: number; created_at: string }
type UserRow = { id: number; username: string; display_name?: string; email?: string; role: string; account_state: string; is_verified: boolean; created_at: string }
type Queue<T> = { items: T[]; total: number }
type Metrics = { days: number; total_users: number; new_bugs: number; open_feedback: number; open_tickets: number; pending_reports: number; resolved_reports: number; critical_cases: number; banned_accounts: number; resolved_cases: number; staff_actions: number }
type Notice = { id: number; event: string; title: string; target_type: string; target_id: number; read_at?: string; created_at: string }
type Audit = { id: number; actor_id: number; action: string; target_type: string; target_id: number; reason: string; created_at: string }
type Appeal = { id: number; action_id: number; user_id: number; body: string; status: string; created_at: string }
type History = { actions: { id: number; action: string; reason: string; created_at: string }[]; reports: { id: number; reason: string; status: string; created_at: string }[] }
type Tab = 'overview' | 'cases' | 'reports' | 'users' | 'appeals' | 'notifications' | 'audit' | 'team'
type AccountAction = 'WARN' | 'RESTRICT' | 'BAN' | 'RESTORE'

const nav: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'cases', label: 'Support cases', icon: ClipboardList },
  { id: 'reports', label: 'Abuse reports', icon: Flag },
  { id: 'users', label: 'Accounts', icon: Users },
  { id: 'appeals', label: 'Appeals', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'audit', label: 'Audit history', icon: Activity },
  { id: 'team', label: 'Staff team', icon: ShieldCheck },
]
const statuses = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED']
const reportStatuses = ['NEW', 'TRIAGED', 'WAITING_FOR_USER', 'DISMISSED', 'WARNED', 'ESCALATED', 'RESOLVED']
const priorities = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL']
const human = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^./, char => char.toUpperCase())
const stamp = (value?: string) => value ? new Date(value).toLocaleString() : ''

export function StaffPage() {
  const client = useQueryClient()
  const logout = useAuth(state => state.logout)
  const [tab, setTab] = useState<Tab>('overview')
  const [days, setDays] = useState(30)
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const [selectedCase, setSelectedCase] = useState<number | null>(null)
  const [selectedReport, setSelectedReport] = useState<number | null>(null)
  const [selectedUser, setSelectedUser] = useState<number | null>(null)
  const [actionTarget, setActionTarget] = useState<UserRow | null>(null)
  const [actionType, setActionType] = useState<AccountAction>('WARN')
  const [actionReason, setActionReason] = useState('')
  const [actionDays, setActionDays] = useState(1)
  const [actionError, setActionError] = useState('')
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [reason, setReason] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const me = useQuery({ queryKey: ['staff-me'], queryFn: () => api<Staff>('/staff/me'), retry: false })
  const enabled = !!me.data
  const metrics = useQuery({ queryKey: ['staff-metrics', days], queryFn: () => api<Metrics>(`/staff/dashboard?days=${days}`), enabled: enabled && tab === 'overview' })
  const cases = useQuery({ queryKey: ['staff-cases', kind, search], queryFn: () => api<Queue<Case>>(query('/staff/cases', { kind, q: search, limit: 50 })), enabled: enabled && tab === 'cases' })
  const caseDetail = useQuery({ queryKey: ['staff-case', selectedCase], queryFn: () => api<Case>(`/staff/cases/${selectedCase}`), enabled: enabled && selectedCase !== null })
  const reports = useQuery({ queryKey: ['staff-reports'], queryFn: () => api<Queue<AbuseReport>>('/staff/reports?limit=50'), enabled: enabled && tab === 'reports' })
  const users = useQuery({ queryKey: ['staff-users', search], queryFn: () => api<Queue<UserRow>>(query('/staff/users', { q: search, limit: 50 })), enabled: enabled && (tab === 'users' || tab === 'team') })
  const history = useQuery({ queryKey: ['staff-user-history', selectedUser], queryFn: () => api<History>(`/staff/users/${selectedUser}/history`), enabled: enabled && selectedUser !== null && tab === 'users' })
  const appeals = useQuery({ queryKey: ['staff-appeals'], queryFn: () => api<Queue<Appeal>>('/staff/appeals'), enabled: enabled && tab === 'appeals' })
  const notifications = useQuery({ queryKey: ['staff-notifications'], queryFn: () => api<Notice[]>('/staff/notifications'), enabled: enabled && tab === 'notifications' })
  const audit = useQuery({ queryKey: ['staff-audit'], queryFn: () => api<Queue<Audit>>('/staff/audit-logs'), enabled: enabled && tab === 'audit' && me.data?.role === 'OWNER' })
  const done = (text: string) => { setError(''); setMessage(text); setReason(''); void client.invalidateQueries({ queryKey: ['staff'] }) }
  const failed = (cause: Error) => { setMessage(''); setError(cause.message) }
  const updateCase = useMutation({ mutationFn: (change: object) => api(`/staff/cases/${selectedCase}`, { method: 'PATCH', body: { ...change, reason: reason || 'Routine case triage' } }), onSuccess: () => done('Case updated.'), onError: failed })
  const sendReply = useMutation({ mutationFn: () => api(`/staff/cases/${selectedCase}/reply`, { method: 'POST', body: { body: reply, internal } }), onSuccess: () => { setReply(''); done(internal ? 'Internal note saved.' : 'Response sent to reporter.') }, onError: failed })
  const updateReport = useMutation({ mutationFn: ({ reportId, status }: { reportId: number; status: string }) => api(`/staff/reports/${reportId}`, { method: 'PATCH', body: { status, reason: reason || 'Reviewed submitted report' } }), onSuccess: () => done('Report updated.'), onError: failed })
  const invite = useMutation({ mutationFn: () => api<{ invite_token: string }>('/staff/moderators/invite', { method: 'POST', body: { email: inviteEmail } }), onSuccess: value => { setInviteToken(value.invite_token); done('Invitation created. Share this token securely with the intended account holder.') }, onError: failed })
  const read = useMutation({ mutationFn: (id: number) => api(`/staff/notifications/${id}/read`, { method: 'POST' }), onSuccess: () => done('Notification read.'), onError: failed })
  const remove = useMutation({ mutationFn: (id: number) => api(`/staff/moderators/${id}`, { method: 'DELETE' }), onSuccess: () => done('Moderator access revoked.'), onError: failed })
  const action = useMutation({ mutationFn: ({ id, type, why, days }: { id: number; type: AccountAction; why: string; days?: number }) => api(`/staff/users/${id}/actions`, { method: 'POST', body: { action: type, reason: why, days } }), onSuccess: () => { setActionTarget(null); setActionError(''); done('Action recorded.') }, onError: (cause: Error) => setActionError(cause.message) })
  const decideAppeal = useMutation({ mutationFn: ({ id, status, why }: { id: number; status: string; why: string }) => api(`/staff/appeals/${id}`, { method: 'PATCH', body: { status, reason: why } }), onSuccess: () => done('Appeal decision recorded.'), onError: failed })

  const openAccountAction = (row: UserRow) => {
    setActionTarget(row)
    setActionType('WARN')
    setActionReason('')
    setActionDays(1)
    setActionError('')
  }
  const submitAccountAction = (event: FormEvent) => {
    event.preventDefault()
    if (!actionTarget || action.isPending) return
    const why = actionReason.trim()
    if (why.length < 10) { setActionError('Give a reason of at least 10 characters.'); return }
    if (actionType === 'RESTRICT' && (!Number.isInteger(actionDays) || actionDays < 1 || actionDays > (me.data?.role === 'OWNER' ? 30 : 7))) {
      setActionError('Choose a valid restriction duration.'); return
    }
    setActionError('')
    action.mutate({ id: actionTarget.id, type: actionType, why, days: actionType === 'RESTRICT' ? actionDays : undefined })
  }

  if (me.isPending) return <div className="staff-gate">Checking staff access…</div>
  if (!me.data) return <div className="staff-gate"><ShieldCheck size={38} /><h1>Staff access requires MFA</h1><p>Sign in with a staff account and complete authenticator verification.</p><Link className="button primary" to="/staff/login">Staff sign in</Link><Link to="/">Back to Relaydot</Link></div>
  return <div className="staff-app"><aside className="staff-nav"><div className="staff-brand"><span>relay<span className="staff-dot">.</span></span><small>TRUST & SAFETY</small></div><nav aria-label="Staff sections">{nav.filter(item => me.data?.role === 'OWNER' || !['audit', 'team'].includes(item.id)).map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setSelectedCase(null); setSelectedReport(null); setError(''); setMessage('') }}><item.icon size={18} /><span>{item.label}</span></button>)}</nav><div className="staff-nav-foot"><strong>@{me.data.username}</strong><small>{human(me.data.role)}</small><Link to="/"><ArrowLeft size={15} /> Open Relaydot</Link><button onClick={() => { void logout().then(() => location.assign('/app/staff/login')) }}>Sign out</button></div></aside>
    <main className="staff-main"><header className="staff-top"><div><span className="staff-eyebrow">RELAYDOT / TRUST & SAFETY</span><h1>{nav.find(item => item.id === tab)?.label}</h1></div><div className="staff-top-meta"><ShieldCheck size={17} /> Secure staff session</div></header>
      {error && <div className="staff-alert error" role="alert">{error}</div>}{message && <div className="staff-alert" role="status">{message}</div>}
      {tab === 'overview' && <><div className="staff-toolbar"><label>Time window <select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select></label></div>{metrics.isPending ? <p>Loading live metrics…</p> : metrics.error ? <p role="alert">{metrics.error.message}</p> : metrics.data && <><div className="staff-stat-grid">{([['Registered users', metrics.data.total_users, Users], ['New bug reports', metrics.data.new_bugs, Bug], ['Open feedback', metrics.data.open_feedback, FileText], ['Open support tickets', metrics.data.open_tickets, LifeBuoy], ['Pending abuse reports', metrics.data.pending_reports, Flag], ['Critical cases', metrics.data.critical_cases, Activity], ['Banned accounts', metrics.data.banned_accounts, ShieldCheck], ['Resolved cases', metrics.data.resolved_cases, CheckCircle2]] as const).map(([label, value, Icon]) => <div className="staff-stat" key={label}><Icon size={19} /><strong>{value}</strong><span>{label}</span></div>)}</div><div className="staff-panel"><h2>Moderator activity</h2><p>{metrics.data.staff_actions} recorded action{metrics.data.staff_actions === 1 ? '' : 's'} in the selected time window. All figures come from the database.</p></div></>}</>}
      {tab === 'cases' && <><div className="staff-toolbar"><label className="staff-search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search cases" aria-label="Search cases" /></label><select value={kind} onChange={event => setKind(event.target.value)} aria-label="Case type"><option value="">All types</option>{['BUG', 'FEEDBACK', 'FEATURE', 'COMPLAINT', 'SUPPORT', 'SECURITY'].map(value => <option key={value}>{value}</option>)}</select><span>{cases.data?.total ?? 0} cases</span></div><div className="staff-split"><div className="staff-list">{cases.isPending && <p>Loading cases…</p>}{cases.data?.items.map(row => <button className={selectedCase === row.id ? 'selected' : ''} key={row.id} onClick={() => setSelectedCase(row.id)}><span className="staff-row-top"><strong>#{row.id} {row.title}</strong><small>{stamp(row.created_at)}</small></span><span>{human(row.kind)} · {row.category} · {human(row.status)}</span><small>{row.description.slice(0, 105)}</small></button>)}{cases.data?.items.length === 0 && <p className="staff-empty">No cases match this filter.</p>}</div><div className="staff-detail">{caseDetail.data ? <><span className="staff-eyebrow">CASE #{caseDetail.data.id} · {human(caseDetail.data.kind)}</span><h2>{caseDetail.data.title}</h2><p className="staff-muted">From user #{caseDetail.data.reporter_id} · {stamp(caseDetail.data.created_at)}</p><p>{caseDetail.data.description}</p>{caseDetail.data.steps && <p><strong>Steps:</strong> {caseDetail.data.steps}</p>}{caseDetail.data.expected && <p><strong>Expected:</strong> {caseDetail.data.expected}</p>}{caseDetail.data.actual && <p><strong>Actual:</strong> {caseDetail.data.actual}</p>}{caseDetail.data.attachment_url && <p><a href={caseDetail.data.attachment_url}>Download submitted evidence</a></p>}<div className="staff-controls"><label>Status<select value={caseDetail.data.status} onChange={event => updateCase.mutate({ status: event.target.value })}>{statuses.map(value => <option key={value}>{value}</option>)}</select></label><label>Priority<select value={caseDetail.data.priority} onChange={event => updateCase.mutate({ priority: event.target.value })}>{priorities.map(value => <option key={value}>{value}</option>)}</select></label></div><label className="staff-field">Reason for change<input value={reason} onChange={event => setReason(event.target.value)} placeholder="Brief reason recorded in audit log" /></label><div className="staff-thread">{caseDetail.data.messages?.map(item => <div key={item.id} className={item.internal ? 'internal' : ''}><small>{item.internal ? 'Internal note' : `User #${item.author_id}`} · {stamp(item.created_at)}</small><p>{item.body}</p></div>)}</div><form onSubmit={(event: FormEvent) => { event.preventDefault(); sendReply.mutate() }}><label className="staff-field">{internal ? 'Internal note' : 'Reply to reporter'}<textarea value={reply} onChange={event => setReply(event.target.value)} minLength={2} maxLength={4000} required /></label><label className="staff-check"><input type="checkbox" checked={internal} onChange={event => setInternal(event.target.checked)} /> Staff-only note</label><button className="button primary" disabled={sendReply.isPending}>Send {internal ? 'note' : 'reply'}</button></form></> : <div className="staff-empty">Select a case to review it and respond.</div>}</div></div></>}
      {tab === 'reports' && <div className="staff-split"><div className="staff-list">{reports.isPending && <p>Loading reports…</p>}{reports.data?.items.map(row => <button key={row.id} className={selectedReport === row.id ? 'selected' : ''} onClick={() => setSelectedReport(row.id)}><span className="staff-row-top"><strong>#{row.id} {human(row.reason)}</strong><small>{stamp(row.created_at)}</small></span><span>{row.entity_type} #{row.entity_id} · {human(row.status)}</span></button>)}{reports.data?.items.length === 0 && <p className="staff-empty">No reports.</p>}</div><div className="staff-detail">{(() => { const row = reports.data?.items.find(item => item.id === selectedReport); return row ? <><span className="staff-eyebrow">ABUSE REPORT #{row.id}</span><h2>{human(row.reason)}</h2><p>Reported {row.entity_type} #{row.entity_id} by user #{row.reporter_id}</p><p>{row.details || 'No additional evidence was submitted.'}</p><p className="staff-muted">Only reporter-submitted details are shown. Private conversations are not available here.</p><label className="staff-field">Document your reason<input value={reason} onChange={event => setReason(event.target.value)} minLength={3} /></label><label className="staff-field">Review outcome<select value={row.status} onChange={event => updateReport.mutate({ reportId: row.id, status: event.target.value })}>{reportStatuses.map(value => <option key={value}>{value}</option>)}</select></label></> : <div className="staff-empty">Select a report to review it.</div> })()}</div></div>}
      {tab === 'users' && <><div className="staff-toolbar"><label className="staff-search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search username or email" /></label></div><div className="staff-table-wrap"><table><thead><tr><th>Account</th><th>State</th><th>Verified</th><th>Joined</th><th>Action</th></tr></thead><tbody>{users.data?.items.map(row => <tr key={row.id}><td><strong>@{row.username}</strong><small>{row.email}</small></td><td>{human(row.account_state)}</td><td>{row.is_verified ? 'Yes' : 'No'}</td><td>{stamp(row.created_at)}</td><td><div className="staff-account-actions">{row.role === 'USER' && <button type="button" className="staff-account-button staff-account-button-action" aria-label={`Take moderation action on @${row.username}`} disabled={action.isPending} onClick={() => openAccountAction(row)}><ShieldAlert size={15} aria-hidden="true" /><span>Take action</span></button>}<button type="button" className={`staff-account-button staff-account-button-history${selectedUser === row.id ? ' is-selected' : ''}`} aria-label={`View moderation history for @${row.username}`} aria-pressed={selectedUser === row.id} onClick={() => setSelectedUser(row.id)}><Clock3 size={15} aria-hidden="true" /><span>History</span></button></div></td></tr>)}</tbody></table>{users.data?.items.length === 0 && <p className="staff-empty">No accounts found.</p>}</div>{selectedUser && <div className="staff-panel"><h2>Account #{selectedUser} moderation history</h2>{history.isPending && <p>Loading history…</p>}{history.data?.actions.map(item => <div className="staff-notice" key={`action-${item.id}`}><Activity size={17} /><div><strong>{human(item.action)}</strong><small>{item.reason} · {stamp(item.created_at)}</small></div></div>)}{history.data?.reports.map(item => <div className="staff-notice" key={`report-${item.id}`}><Flag size={17} /><div><strong>Reported: {human(item.reason)}</strong><small>{human(item.status)} · {stamp(item.created_at)}</small></div></div>)}{history.data && !history.data.actions.length && !history.data.reports.length && <p>No moderation history.</p>}</div>}</>}
      {tab === 'appeals' && <div className="staff-panel"><h2>Appeals queue</h2>{appeals.isPending && <p>Loading appeals…</p>}{appeals.data?.items.map(item => <div className="staff-appeal" key={item.id}><strong>Appeal #{item.id} · user #{item.user_id} · {human(item.status)}</strong><p>Action #{item.action_id}: {item.body}</p><small>{stamp(item.created_at)}</small>{['OPEN', 'ESCALATED'].includes(item.status) && <div className="staff-appeal-actions"><button className="staff-link" onClick={() => { const why = prompt('Reason for escalation (at least 10 characters)'); if (why && why.length >= 10) decideAppeal.mutate({ id: item.id, status: 'ESCALATED', why }) }}>Escalate</button><button className="staff-link" onClick={() => { const why = prompt('Reason for denial (at least 10 characters)'); if (why && why.length >= 10) decideAppeal.mutate({ id: item.id, status: 'DENIED', why }) }}>Deny</button>{me.data.role === 'OWNER' && <button className="staff-link" onClick={() => { const why = prompt('Reason to approve and restore account (at least 10 characters)'); if (why && why.length >= 10) decideAppeal.mutate({ id: item.id, status: 'APPROVED', why }) }}>Approve and restore</button>}</div>}</div>)}{appeals.data?.items.length === 0 && <p className="staff-empty">No appeals yet.</p>}</div>}
      {tab === 'notifications' && <div className="staff-panel"><h2>Staff notifications</h2>{notifications.data?.map(row => <div className="staff-notice" key={row.id}><Bell size={17} /><div><strong>{row.title}</strong><small>{stamp(row.created_at)} · {row.read_at ? 'Read' : 'Unread'}</small></div>{!row.read_at && <button className="staff-link" onClick={() => read.mutate(row.id)}>Mark read</button>}</div>)}{notifications.data?.length === 0 && <p className="staff-empty">No notifications yet.</p>}</div>}
      {tab === 'audit' && me.data.role === 'OWNER' && <div className="staff-panel"><h2>Privileged activity</h2><p className="staff-muted">Append-only application events. Database operators must protect backups and access separately.</p>{audit.data?.items.map(row => <div className="staff-notice" key={row.id}><Activity size={17} /><div><strong>{human(row.action)} · {row.target_type} #{row.target_id}</strong><small>Actor #{row.actor_id} · {stamp(row.created_at)} · {row.reason}</small></div></div>)}{audit.data?.items.length === 0 && <p className="staff-empty">No actions in the log.</p>}</div>}
      {tab === 'team' && me.data.role === 'OWNER' && <><div className="staff-panel"><h2>Invite a moderator</h2><p>Invitees need an existing verified account with authenticator MFA. The invitation expires after 24 hours.</p><form className="staff-inline" onSubmit={(event: FormEvent) => { event.preventDefault(); invite.mutate() }}><input type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="Moderator email" required /><button className="button primary" disabled={invite.isPending}>Create invitation</button></form>{inviteToken && <div className="staff-token"><p>Share this one-time token securely. It will not be shown again.</p><code>{inviteToken}</code><button className="staff-link" onClick={() => { void navigator.clipboard.writeText(inviteToken) }}>Copy</button></div>}</div><div className="staff-panel"><h2>Current moderators</h2>{users.data?.items.filter(row => row.role === 'MODERATOR').map(row => <div className="staff-notice" key={row.id}><Users size={17} /><div><strong>@{row.username}</strong><small>{row.email}</small></div><button className="staff-link danger" onClick={() => { if (confirm(`Revoke moderator access for @${row.username}?`)) remove.mutate(row.id) }}>Remove</button></div>)}</div></>}
    </main>
    {actionTarget && <div className="staff-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !action.isPending) setActionTarget(null) }} onKeyDown={event => { if (event.key === 'Escape' && !action.isPending) setActionTarget(null) }}>
      <section className="staff-modal" role="dialog" aria-modal="true" aria-labelledby="staff-action-title">
        <header><div><span className="staff-eyebrow">ACCOUNT MODERATION</span><h2 id="staff-action-title">Take action on @{actionTarget.username}</h2></div><button type="button" className="staff-modal-close" aria-label="Close action dialog" onClick={() => setActionTarget(null)} disabled={action.isPending}><X size={19} /></button></header>
        <form onSubmit={submitAccountAction}>
          <p className="staff-modal-intro">Choose an action and document the reason. The decision is recorded in the staff audit history.</p>
          <label className="staff-field">Action<select autoFocus value={actionType} onChange={event => { setActionType(event.target.value as AccountAction); setActionError('') }}><option value="WARN">Warn account</option><option value="RESTRICT">Restrict account</option>{me.data.role === 'OWNER' && <><option value="BAN">Ban account</option><option value="RESTORE">Restore account</option></>}</select></label>
          {actionType === 'RESTRICT' && <label className="staff-field">Duration in days<input type="number" min={1} max={me.data.role === 'OWNER' ? 30 : 7} step={1} value={actionDays} onChange={event => setActionDays(Number(event.target.value))} required /></label>}
          <label className="staff-field">Reason<textarea value={actionReason} onChange={event => setActionReason(event.target.value)} minLength={10} maxLength={500} placeholder="Explain the action for the audit record" required /></label>
          {actionError && <p className="staff-modal-error" role="alert">{actionError}</p>}
          <div className="staff-modal-actions"><button type="button" className="staff-modal-cancel" onClick={() => setActionTarget(null)} disabled={action.isPending}>Cancel</button><button type="submit" className="staff-modal-submit" disabled={action.isPending}>{action.isPending ? 'Recording…' : `Record ${human(actionType)}`}</button></div>
        </form>
      </section>
    </div>}
  </div>
}
