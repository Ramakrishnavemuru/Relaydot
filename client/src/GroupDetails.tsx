import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, query } from './api'
import { Avatar, ErrorBox } from './components'
import { useAuth } from './store'
import type { Conversation, User } from './types'

export function GroupDetails({ conversation, close, left }: { conversation: Conversation; close: () => void; left: () => void }) {
  const me = useAuth(state => state.user)
  const client = useQueryClient()
  const [name, setName] = useState(conversation.name || '')
  const [description, setDescription] = useState(conversation.description || '')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const group = useQuery({ queryKey: ['group', conversation.id], queryFn: () => api<Conversation>(`/conversations/${conversation.id}`) })
  const users = useQuery({ queryKey: ['group-search', search], queryFn: () => api<User[]>(query('/users/search', { q: search })), enabled: search.trim().length > 0 })
  const admin = group.data?.members?.some(member => member.user_id === me?.id && member.role === 'ADMIN')
  const run = async (action: () => Promise<unknown>) => {
    setPending(true); setError('')
    try { await action(); await client.invalidateQueries({ queryKey: ['group', conversation.id] }); await client.invalidateQueries({ queryKey: ['conversations'] }); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update group.'); return false }
    finally { setPending(false) }
  }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><div className="dialog-card" role="dialog" aria-modal="true" aria-label="Group details"><header><h2>{group.data?.name || conversation.name}</h2><button className="icon-button" onClick={close}>Close</button></header>{group.error && <ErrorBox error={group.error} />}{group.data && <div className="group-details"><p>{group.data.description}</p><h3>Members</h3>{group.data.members?.map(member => <div className="session-row" key={member.user_id}><span><Avatar user={member.user} size="sm" /> {member.user?.display_name || member.user?.username || `User ${member.user_id}`} · {member.role}</span>{admin && member.user_id !== me?.id && <button className="text-button" disabled={pending} onClick={() => { if (confirm('Remove this member?')) void run(() => api(`/groups/${conversation.id}/members/${member.user_id}`, { method: 'DELETE' })) }}>Remove</button>}</div>)}{admin && <><form className="profile-edit-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void run(() => api(`/groups/${conversation.id}`, { method: 'PUT', body: { name, description } })) }}><label>Group name<input value={name} onChange={event => setName(event.target.value)} required /></label><label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} /></label><button className="button secondary" disabled={pending}>Save group details</button></form><label className="group-member-search">Add member<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search people" /></label>{users.data?.filter(person => !group.data?.members?.some(member => member.user_id === person.id)).map(person => <button className="person-row" key={person.id} disabled={pending} onClick={() => void run(() => api(`/groups/${conversation.id}/members`, { method: 'POST', body: { user_id: person.id } }))}><Avatar user={person} />{person.display_name || person.username}</button>)}</>}<button className="button secondary" disabled={pending} onClick={() => { if (confirm('Leave this group?')) void run(() => api(`/groups/${conversation.id}/leave`, { method: 'POST' })).then(success => { if (success) { close(); left() } }) }}>Leave group</button>{error && <p className="form-error">{error}</p>}</div>}</div></div>
}
