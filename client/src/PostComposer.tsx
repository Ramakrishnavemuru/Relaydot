import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ImagePlus, Users, X } from 'lucide-react'
import { api, query } from './api'
import { Avatar } from './components'
import { useAuth } from './store'
import { deleteQueuedPost, queuedPosts, saveQueuedPost, synchronizeOfflinePosts, type QueuedPost } from './offlineQueue'
import type { User } from './types'

function useQueue(userId: number) {
  const [rows, setRows] = useState<QueuedPost[]>([])
  useEffect(() => {
    let active = true
    const refresh = () => { void queuedPosts(userId).then(items => { if (active) setRows(items) }).catch(() => {}) }
    refresh()
    window.addEventListener('relay-offline-queue-change', refresh)
    return () => { active = false; window.removeEventListener('relay-offline-queue-change', refresh) }
  }, [userId])
  return rows
}

function AttachmentPreview({ file }: { file: File }) {
  const [src, setSrc] = useState('')
  useEffect(() => { const url = URL.createObjectURL(file); setSrc(url); return () => URL.revokeObjectURL(url) }, [file])
  return file.type.startsWith('image/') ? <img className="queue-thumbnail" src={src} alt="Queued attachment" /> :
    <video className="queue-thumbnail" src={src} muted playsInline preload="metadata" aria-label="Queued video" />
}

export function OfflineQueueButton({ onOpen }: { onOpen: () => void }) {
  const userId = useAuth(state => state.user?.id || 0)
  const rows = useQueue(userId)
  const pending = rows.filter(row => row.status !== 'Published').length
  return <button className="offline-queue-button" onClick={onOpen}>Offline Queue {pending > 0 && <span>{pending}</span>}</button>
}

export function OfflineQueuePanel({ close, edit }: { close: () => void; edit: (post: QueuedPost) => void }) {
  const userId = useAuth(state => state.user?.id || 0)
  const rows = useQueue(userId)
  const [error, setError] = useState('')
  const retry = async (row: QueuedPost) => {
    try { await saveQueuedPost({ ...row, status: 'Queued', attempts: 0, nextAttemptAt: 0, error: undefined }); void synchronizeOfflinePosts(userId, true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not retry this post') }
  }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><div className="dialog-card offline-queue-dialog" role="dialog" aria-modal="true" aria-labelledby="queue-title" onKeyDown={event => { if (event.key === 'Escape') close() }}><header><div><h2 id="queue-title">Offline Queue</h2><small>Drafts and posts waiting to publish on this device</small></div><button autoFocus className="icon-button" onClick={close} aria-label="Close"><X size={21} /></button></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="offline-queue-list">{rows.length ? rows.map(row => <article key={row.id} className="offline-queue-item"><div className="offline-queue-preview">{row.file && <AttachmentPreview file={row.file} />}{!row.file && row.mediaUrl && (row.mediaType === 'VIDEO' ? <video className="queue-thumbnail" src={row.mediaUrl} muted playsInline preload="metadata" /> : <img className="queue-thumbnail" src={row.mediaUrl} alt="Post attachment" />)}<div><p>{row.content || row.file?.name || 'Media post'}</p><small>{new Date(row.createdAt).toLocaleString()}</small>{row.collaboratorIds.length > 0 && <small>{row.collaboratorIds.length} collaborators · {row.status === 'Published' ? 'invitations sent' : 'pending validation'}</small>}</div></div><div className="offline-queue-meta"><span className={`queue-status queue-${row.status.toLowerCase().replace(' ', '-')}`}>{row.status === 'Queued' && !navigator.onLine ? 'Queued — Waiting for Internet' : row.status}</span>{row.error && <small>{row.error}</small>}</div><div className="offline-queue-actions">{row.status === 'Published' && row.publishedPostId && <Link to={`/posts/${row.publishedPostId}`} onClick={close}>View post</Link>}{row.status !== 'Published' && row.status !== 'Syncing' && <><button type="button" onClick={() => void retry(row)}>{row.status === 'Draft' ? 'Queue' : 'Retry'}</button><button type="button" onClick={() => edit(row)}>Edit</button></>}{row.status !== 'Syncing' && <button type="button" className="danger" onClick={() => void deleteQueuedPost(row.id, userId)}>{row.status === 'Published' ? 'Clear' : 'Delete'}</button>}</div></article>) : <p className="queue-empty">Nothing in your offline queue yet.</p>}</div></div></div>
}

export function PostComposer({ close, initial }: { close: () => void; initial?: QueuedPost | null }) {
  const userId = useAuth(state => state.user?.id || 0)
  const [content, setContent] = useState(initial?.content || '')
  const [file, setFile] = useState<File | null>(initial?.file instanceof File ? initial.file : null)
  const [poll, setPoll] = useState<string[]>(initial?.pollOptions || [])
  const [selected, setSelected] = useState<User[]>(initial?.collaborators || [])
  const [selectedIds, setSelectedIds] = useState<number[]>(initial?.collaboratorIds || [])
  const [picker, setPicker] = useState(false)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!picker || term.trim().length < 2) { setResults([]); return }
    let active = true
    const timer = setTimeout(() => { void api<User[]>(query('/social/mentions/suggestions', { q: term.trim() })).then(rows => { if (active) setResults(rows) }).catch(() => { if (active) setResults([]) }) }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [term, picker])
  const save = async (status: 'Draft' | 'Queued') => {
    if (!content.trim() && !file && !poll.length) return
    setSaving(true); setError('')
    try {
      const row: QueuedPost = {
        id: initial?.id || crypto.randomUUID(), userId, content: content.trim(), file,
        mediaUrl: initial?.file === file ? initial?.mediaUrl : null,
        mediaType: file ? file.type === 'image/gif' ? 'GIF' : file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE' : null,
        pollOptions: poll.length ? poll.map(value => value.trim()) : null,
        collaboratorIds: selectedIds, collaborators: selected.filter(user => selectedIds.includes(user.id)),
        createdAt: initial?.createdAt || Date.now(),
        status, attempts: 0, nextAttemptAt: 0,
      }
      if (poll.length && (poll.length < 2 || poll.some(value => !value.trim()))) throw new Error('Complete both poll options first.')
      if (file && !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, GIF, or MP4 file.')
      if (file && file.size > 15 * 1024 * 1024) throw new Error('Posts support attachments up to 15 MB.')
      await saveQueuedPost(row)
      close()
      if (status === 'Queued') void synchronizeOfflinePosts(userId, true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this post') }
    finally { setSaving(false) }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void save('Queued') }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="compose-title" onKeyDown={event => { if (event.key === 'Escape' && !picker) close() }}><header><h2 id="compose-title">{initial ? 'Edit queued post' : 'Create post'}</h2><button className="icon-button" onClick={close} aria-label="Close"><X size={21} /></button></header><form onSubmit={submit}><textarea autoFocus maxLength={5000} value={content} onChange={event => setContent(event.target.value)} placeholder="What's happening?" aria-label="Post text" />{poll.map((option, index) => <input className="poll-input" key={index} value={option} onChange={event => setPoll(poll.map((value, i) => i === index ? event.target.value : value))} placeholder={`Poll option ${index + 1}`} maxLength={100} required />)}{file && <div className="file-chip">{file.name}<button type="button" onClick={() => setFile(null)} aria-label="Remove attachment"><X size={16} /></button></div>}
    {selectedIds.length > 0 && <div className="selected-collaborators">{selectedIds.map(id => { const user = selected.find(item => item.id === id); return <span key={id}>{user && <Avatar user={user} />}@{user?.username || `user ${id}`}<button type="button" onClick={() => setSelectedIds(selectedIds.filter(value => value !== id))} aria-label={`Remove collaborator ${user?.username || id}`}><X size={14} /></button></span> })}</div>}
    {selectedIds.length > 0 && !navigator.onLine && <small className="queue-hint">Collaborators will be validated when this post syncs.</small>}
    {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="text-button" onClick={() => setPoll(poll.length ? [] : ['', ''])}>{poll.length ? 'Remove poll' : 'Add poll'}</button>{poll.length > 0 && poll.length < 6 && <button type="button" className="text-button" onClick={() => setPoll([...poll, ''])}>Add option</button>}<button type="button" className="text-button" onClick={() => setPicker(true)}><Users size={18} /> Add Collaborators</button><label className="file-button"><ImagePlus size={22} /><span>Photo or video</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4" onChange={event => setFile(event.target.files?.[0] || null)} /></label><button type="button" className="button" disabled={saving || (!content.trim() && !file && !poll.length)} onClick={() => void save('Draft')}>Save draft</button><button className="button primary" disabled={saving || (!content.trim() && !file && !poll.length)}>{saving ? 'Saving…' : navigator.onLine ? 'Post' : 'Queue post'}</button></div></form></div>
    {picker && <div className="dialog-backdrop collaborator-picker-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPicker(false) }}><div className="dialog-card collaborator-picker" role="dialog" aria-modal="true" aria-labelledby="collaborator-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setPicker(false) } }}><header><h2 id="collaborator-title">Add Collaborators</h2><button className="icon-button" onClick={() => setPicker(false)} aria-label="Close collaborator search"><X size={21} /></button></header><input autoFocus value={term} onChange={event => setTerm(event.target.value)} placeholder="Search usernames" aria-label="Search users" /><div className="collaborator-results">{results.filter(user => user.id !== userId).map(user => <button type="button" key={user.id} onClick={() => { setSelected(current => [...current.filter(item => item.id !== user.id), user]); setSelectedIds(current => current.includes(user.id) ? current.filter(id => id !== user.id) : [...current, user.id]) }}><Avatar user={user} /><span>{user.display_name || user.username}<small>@{user.username}</small></span><span>{selectedIds.includes(user.id) ? 'Selected' : 'Add'}</span></button>)}{term.length >= 2 && !results.length && <p>No users found. Search is available while online.</p>}</div><div className="dialog-actions"><button className="button primary" onClick={() => setPicker(false)}>Done</button></div></div></div>}
  </div>
}
