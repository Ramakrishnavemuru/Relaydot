import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../store'

type Action = { id: number; action: string; reason: string; created_at: string }
type Appeal = { id: number; action_id: number; status: string }

export function AppealPage() {
  const logout = useAuth(state => state.logout)
  const queryClient = useQueryClient()
  const [body, setBody] = useState<Record<number, string>>({})
  const [notice, setNotice] = useState('')
  const actions = useQuery({ queryKey: ['appeal-actions'], queryFn: () => api<Action[]>('/support/actions') })
  const appeals = useQuery({ queryKey: ['appeal-records'], queryFn: () => api<Appeal[]>('/support/appeals') })
  const submit = useMutation({
    mutationFn: (actionId: number) => api('/support/appeals', { method: 'POST', body: { action_id: actionId, body: body[actionId] } }),
    onSuccess: () => { setNotice('Your appeal was submitted.'); void queryClient.invalidateQueries({ queryKey: ['appeal-records'] }) },
  })

  return <main className="appeal-page">
    <header className="appeal-header"><strong className="wordmark">relay<span>.</span></strong><button className="button secondary" onClick={() => void logout()}>Sign out</button></header>
    <div className="appeal-content"><p className="eyebrow">ACCOUNT REVIEW</p><h1>Your account is unavailable</h1><p>You can review the action taken on your account and request a review here. Your appeal goes to the Relaydot staff queue.</p>
      {notice && <p role="status">{notice}</p>}{submit.error && <p className="form-error" role="alert">{submit.error.message}</p>}
      {actions.isPending && <p>Loading account actions…</p>}{actions.isError && <p role="alert">Could not load account actions. Please retry.</p>}
      {actions.data?.map(action => { const previous = appeals.data?.find(appeal => appeal.action_id === action.id); return <section className="settings-panel" key={action.id}>
        <h2>{action.action.toLowerCase()} · {new Date(action.created_at).toLocaleDateString()}</h2><p>{action.reason}</p>
        {previous ? <p>Appeal #{previous.id}: {previous.status.toLowerCase()}</p> : <form className="settings-form" onSubmit={(event: FormEvent) => { event.preventDefault(); submit.mutate(action.id) }}><label>Why should this action be reviewed?<textarea minLength={10} maxLength={4000} required value={body[action.id] || ''} onChange={event => setBody({ ...body, [action.id]: event.target.value })} /></label><button className="button primary" disabled={submit.isPending}>Submit appeal</button></form>}
      </section> })}
    </div>
  </main>
}
