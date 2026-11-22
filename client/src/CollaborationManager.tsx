import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, X } from 'lucide-react'
import { api, query } from './api'
import { Avatar } from './components'
import { useAuth } from './store'
import type { Post, User } from './types'

type Collaboration = { id: number; user_id: number; user: User; status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' }

export function CollaborationManager({ post, close }: { post: Post; close: () => void }) {
  const viewerId = useAuth(state => state.user?.id)
  const client = useQueryClient()
  const owner = viewerId === post.author_id
  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<User[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const list = useQuery({ queryKey: ['post-collaborators', post.id], queryFn: () => api<{ items: Collaboration[] }>(`/social/posts/${post.id}/collaborators`) })
  useEffect(() => {
    if (!owner || term.trim().length < 2) { setMatches([]); return }
    let active = true
    const timer = setTimeout(() => { void api<User[]>(query('/social/mentions/suggestions', { q: term.trim() })).then(users => { if (active) setMatches(users) }).catch(() => { if (active) setMatches([]) }) }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [term, owner])
  const refresh = () => { void client.invalidateQueries({ queryKey: ['post-collaborators', post.id] }); for (const key of ['feed', 'post', 'profile-posts']) void client.invalidateQueries({ queryKey: [key] }) }
  const run = async (path: string, method: 'POST' | 'DELETE') => { setBusy(true); setError(''); try { await api(path, { method }); refresh(); setTerm('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update collaboration') } finally { setBusy(false) } }
  const rows = list.data?.items || []
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><div className="dialog-card collaborator-manager" role="dialog" aria-modal="true" aria-labelledby="manage-collaborators-title"><header><h2 id="manage-collaborators-title"><Users size={20} /> Collaborators</h2><button className="icon-button" onClick={close} aria-label="Close"><X size={20} /></button></header><div className="collaborator-manager-body"><p>The original creator owns this post. Accepted collaborators share this post and its likes and comments.</p>{owner && <label>Invite someone<input value={term} onChange={event => setTerm(event.target.value)} placeholder="Search usernames" /></label>}{owner && matches.filter(user => user.id !== viewerId).map(user => <button className="collaborator-search-result" key={user.id} disabled={busy || rows.some(row => row.user_id === user.id && ['PENDING', 'ACCEPTED'].includes(row.status))} onClick={() => void run(`/social/posts/${post.id}/collaborators/${user.id}`, 'POST')}><Avatar user={user} /> @{user.username}<span>Invite</span></button>)}<h3>Invitations and collaborators</h3>{rows.length ? rows.map(row => <div className="collaborator-management-row" key={row.id}><Avatar user={row.user} /><span><strong>@{row.user?.username}</strong><small>{row.status.toLowerCase()}</small></span>{(owner && ['PENDING', 'ACCEPTED'].includes(row.status) || viewerId === row.user_id && row.status === 'ACCEPTED') && <button disabled={busy} onClick={() => void run(`/social/posts/${post.id}/collaborators/${row.user_id}`, 'DELETE')}>{row.status === 'PENDING' ? 'Revoke' : 'Remove'}</button>}</div>) : <p>No collaborators yet.</p>}{error && <p className="form-error" role="alert">{error}</p>}</div></div></div>
}
