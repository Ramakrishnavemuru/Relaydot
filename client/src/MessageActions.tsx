import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bookmark, Heart, MoreHorizontal, Pin, Reply, Trash2 } from 'lucide-react'
import { api } from './api'
import type { Message } from './types'

export function MessageActions({ message, mine, onReply }: { message: Message; mine: boolean; onReply: () => void }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reacting, setReacting] = useState(false)
  const [error, setError] = useState('')
  const run = async (path: string, method: string, body?: object) => {
    try { await api(path, { method, body }); setError(''); setOpen(false); setReacting(false); await client.invalidateQueries({ queryKey: ['messages', message.conversation_id] }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed') }
  }
  return <div className="message-tools"><button className="message-more" aria-label="Message actions" onClick={() => { setOpen(!open); setReacting(false) }}><MoreHorizontal size={16} /></button>{open && <div className="message-menu"><button onClick={() => { onReply(); setOpen(false) }}><Reply size={15} /> Reply</button><button onClick={() => setReacting(!reacting)} aria-expanded={reacting}><Heart size={15} /> React</button>{reacting && <div className="message-reaction-options" aria-label="Choose reaction">{['❤️', '😂', '👍', '😮', '😢', '🙏'].map(emoji => <button type="button" key={emoji} aria-label={`React ${emoji}`} onClick={() => void run(`/messages/${message.id}/reaction`, 'POST', { emoji })}>{emoji}</button>)}</div>}<button onClick={() => void run(`/messages/${message.id}/bookmark`, message.bookmarked ? 'DELETE' : 'POST')}><Bookmark size={15} /> {message.bookmarked ? 'Unsave' : 'Save'}</button><button onClick={() => void run(`/messages/${message.id}/pin`, message.pinned_at ? 'DELETE' : 'POST')}><Pin size={15} /> {message.pinned_at ? 'Unpin' : 'Pin'}</button>{mine && !message.is_deleted && <><button onClick={() => { const content = prompt('Edit message', message.content); if (content?.trim()) void run(`/messages/${message.id}`, 'PUT', { content }) }}>Edit</button><button onClick={() => { if (confirm('Delete this message?')) void run(`/messages/${message.id}`, 'DELETE') }}><Trash2 size={15} /> Delete</button></>}</div>}{error && <span className="message-action-error">{error}</span>}</div>
}
