import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, query } from './api'
import { Avatar, ErrorBox, GlassDialog } from './components'
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
  return <GlassDialog title={group.data?.name || conversation.name || 'Group details'} onClose={close}>
    {group.isPending && <div className="loading-list" role="status">Loading group details…</div>}
    {group.error && <ErrorBox error={group.error} retry={() => void group.refetch()} />}
    {group.data && <div className="group-details">
      {group.data.description && <p className="muted">{group.data.description}</p>}
      <section aria-label="Group members">
        <h3>Members <span className="group-member-count">{group.data.members?.length || 0}</span></h3>
        {group.data.members?.map(member => <div className="session-row" key={member.user_id}>
          <Avatar user={member.user} size="sm" />
          <div className="group-member-identity">
            <strong>{member.user?.display_name || member.user?.username || `User ${member.user_id}`}</strong>
            <small>{member.role === 'ADMIN' ? 'Admin' : 'Member'}</small>
          </div>
          {admin && member.user_id !== me?.id && <button className="text-button" disabled={pending} onClick={() => {
            if (confirm('Remove this member?')) void run(() => api(`/groups/${conversation.id}/members/${member.user_id}`, { method: 'DELETE' }))
          }}>Remove</button>}
        </div>)}
      </section>
      {admin && <section aria-label="Manage group">
        <h3>Manage group</h3>
        <form className="profile-edit-form" onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void run(() => api(`/groups/${conversation.id}`, { method: 'PUT', body: { name, description } }))
        }}>
          <label>Group name<input value={name} onChange={event => setName(event.target.value)} required /></label>
          <label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} /></label>
          <button className="button secondary" disabled={pending}>Save group details</button>
        </form>
        <label className="group-member-search">Add member<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search people" /></label>
        {users.data?.filter(person => !group.data?.members?.some(member => member.user_id === person.id)).map(person =>
          <button className="person-row" key={person.id} disabled={pending}
            onClick={() => void run(() => api(`/groups/${conversation.id}/members`, { method: 'POST', body: { user_id: person.id } }))}>
            <Avatar user={person} />{person.display_name || person.username}
          </button>
        )}
      </section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button secondary" disabled={pending} onClick={() => {
        if (confirm('Leave this group?')) void run(() => api(`/groups/${conversation.id}/leave`, { method: 'POST' })).then(success => {
          if (success) { close(); left() }
        })
      }}>Leave group</button>
    </div>}
  </GlassDialog>
}
