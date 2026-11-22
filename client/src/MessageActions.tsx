import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Bookmark, Heart, MoreHorizontal, Pencil, Pin, Reply, Trash2, X } from 'lucide-react'
import { api } from './api'
import type { Message } from './types'

const reactionChoices = ['❤️', '😂', '👍', '😮', '😢', '🙏']

export function MessageActions({ message, mine, onReply, quickOpen, onQuickClose, currentId }: { message: Message; mine: boolean; onReply: () => void; quickOpen: boolean; onQuickClose: () => void; currentId?: number }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reacting, setReacting] = useState(false)
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  const [draft, setDraft] = useState(message.content)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const run = async (path: string, method: string, body?: object) => {
    setPending(true)
    try {
      const updated = await api<Message>(path, { method, body })
      if (method === 'PUT' || path.endsWith('/reaction') || (method === 'DELETE' && path === `/messages/${message.id}`)) {
        client.setQueryData<Message[]>(['messages', message.conversation_id], rows => rows?.map(row => row.id === message.id ? updated : row))
      }
      setError(''); setOpen(false); setReacting(false); setDialog(null); onQuickClose()
      await Promise.all([client.invalidateQueries({ queryKey: ['messages', message.conversation_id] }), client.invalidateQueries({ queryKey: ['conversations'] })])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed') }
    finally { setPending(false) }
  }
  const submitEdit = (event: FormEvent) => {
    event.preventDefault()
    if (draft.trim() && draft.trim() !== message.content && !pending) void run(`/messages/${message.id}`, 'PUT', { content: draft.trim() })
  }
  return <><div className="message-tools">
    {quickOpen && !message.is_deleted && <div className="message-quick-react" role="group" aria-label="React to message">
      {reactionChoices.map(emoji => <button type="button" key={emoji} className={message.reactions?.some(reaction => reaction.user_id === currentId && reaction.emoji === emoji) ? 'selected' : ''} aria-label={`React ${emoji}`} disabled={pending} onClick={() => void run(`/messages/${message.id}/reaction`, 'POST', { emoji })}>{emoji}</button>)}
      <button type="button" className="quick-react-close" aria-label="Close reactions" onClick={onQuickClose}><X size={15} /></button>
    </div>}
    <button type="button" className="message-more" aria-label="Message actions" aria-expanded={open} onClick={() => { setOpen(!open); setReacting(false); setDialog(null) }}><MoreHorizontal size={16} /></button>
    {open && <div className="message-menu">
      <button type="button" onClick={() => { onReply(); setOpen(false) }}><Reply size={15} /> Reply</button>
      {!message.is_deleted && <><button type="button" onClick={() => setReacting(!reacting)} aria-expanded={reacting}><Heart size={15} /> React</button>
      {reacting && <div className="message-reaction-options" aria-label="Choose reaction">{reactionChoices.map(emoji => <button type="button" key={emoji} aria-label={`React ${emoji}`} disabled={pending} onClick={() => void run(`/messages/${message.id}/reaction`, 'POST', { emoji })}>{emoji}</button>)}</div>}
      <button type="button" disabled={pending} onClick={() => void run(`/messages/${message.id}/bookmark`, message.bookmarked ? 'DELETE' : 'POST')}><Bookmark size={15} /> {message.bookmarked ? 'Unsave' : 'Save'}</button>
      <button type="button" disabled={pending} onClick={() => void run(`/messages/${message.id}/pin`, message.pinned_at ? 'DELETE' : 'POST')}><Pin size={15} /> {message.pinned_at ? 'Unpin' : 'Pin'}</button>
      {mine && message.message_type === 'TEXT' && <button type="button" onClick={() => { setDraft(message.content); setDialog('edit'); setOpen(false) }}><Pencil size={15} /> Edit</button>}
      {mine && <button type="button" onClick={() => { setDialog('delete'); setOpen(false) }}><Trash2 size={15} /> Delete</button>}</>}
    </div>}
    {error && !dialog && <span className="message-action-error" role="alert">{error}</span>}
  </div>
    {dialog && createPortal(<div className="message-action-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !pending) setDialog(null) }}>
      <div className="message-action-dialog" role="dialog" aria-modal="true" aria-label={dialog === 'edit' ? 'Edit message' : 'Delete message'}>
        {dialog === 'edit' ? <form onSubmit={submitEdit}><h2>Edit message</h2><textarea autoFocus value={draft} maxLength={10000} onChange={event => setDraft(event.target.value)} aria-label="Message text" /><div className="message-action-buttons"><button type="button" onClick={() => setDialog(null)} disabled={pending}>Cancel</button><button type="submit" className="primary" disabled={pending || !draft.trim() || draft.trim() === message.content}>{pending ? 'Saving…' : 'Save changes'}</button></div></form>
          : <div><h2>Delete message?</h2><p>Everyone in this chat will see that the message was deleted.</p><div className="message-action-buttons"><button type="button" onClick={() => setDialog(null)} disabled={pending}>Cancel</button><button type="button" className="danger" disabled={pending} onClick={() => void run(`/messages/${message.id}`, 'DELETE')}>{pending ? 'Deleting…' : 'Delete message'}</button></div></div>}
        {error && <p className="message-action-error" role="alert">{error}</p>}
      </div>
    </div>, document.body)}
  </>
}
