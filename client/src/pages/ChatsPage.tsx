import { FormEvent, Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Archive, Ban, BellOff, CalendarClock, Eraser, Heart, ImagePlus, Info, Lock, MessageCircle, MoreHorizontal, Paperclip, Phone, PhoneOff, Pin, Plus, Search, Send, Smile, Timer, Trash2, Unlock, UserRound, Users, Video, X, ArrowLeft } from 'lucide-react'
import { api, imagePreviewUrl, mediaUrl, query, upload } from '../api'
import { Avatar, Empty, ErrorBox, Shell, timeAgo } from '../components'
import { useAuth } from '../store'
import type { Conversation, Message, User } from '../types'
import { MessageActions } from '../MessageActions'
import { useCall } from '../calls'
import { GroupDetails } from '../GroupDetails'
import { EmojiPicker } from '../EmojiPicker'
import type { AccountSettings } from '../settings'

const displayName = (conv: Conversation) => conv.is_locked && !conv.is_unlocked ? `Locked chat #${conv.id}` : conv.type === 'GROUP' ? conv.name || 'Group' : conv.other_user?.display_name || conv.other_user?.username || 'Conversation'
const displayAvatar = (conv: Conversation): User => conv.type === 'GROUP'
  ? { id: conv.id, username: conv.name || 'Group', avatar_url: conv.avatar_url }
  : conv.other_user || { id: 0, username: 'Conversation' }

type ScheduledMessage = { id: number; conversation_id: number; content: string; send_at: string; expires_in_seconds?: number | null }
type SendInput = { conversationId: number; content: string; file: File | null; reply: Message | null; expiresInSeconds: number }
const disappearingOptions = [
  { value: 0, label: 'Off' },
  { value: 60, label: 'After 1 minute' },
  { value: 3600, label: 'After 1 hour' },
  { value: 86400, label: 'After 1 day' },
  { value: 604800, label: 'After 7 days' },
]
const scheduleDefault = () => {
  const date = new Date(Date.now() + 15 * 60_000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
const threadDay = (value: string) => new Date(value).toDateString()
const threadTime = (value: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const fullTime = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

const ChatMessage = memo(function ChatMessage({ item, selected, currentId, onReply, settings }: {
  item: Message; selected: Conversation; currentId?: number; onReply: (item: Message) => void; settings?: AccountSettings
}) {
  const mine = item.sender_id === currentId
  const [loadMedia, setLoadMedia] = useState(false)
  return <div className={`message-row ${mine ? 'mine' : ''}`}>
    {!mine && <Avatar user={item.sender || selected.other_user} size="sm" />}
    <div className="message-bubble" title={fullTime(item.created_at)}>
      {item.reply_to && <div className="reply-preview"><strong>{item.reply_to.sender_name}</strong><span>{item.reply_to.content}</span></div>}
      {selected.type === 'GROUP' && !mine && <strong>{item.sender?.display_name || item.sender?.username}</strong>}
      {item.is_deleted ? <em>This message was deleted</em> : <>{item.content && <p>{item.content}</p>}{item.attachments?.map(file => file.file_type.startsWith('image/') ? settings?.auto_download_images === false && !loadMedia ? <button type="button" className="attachment-link" key={file.file_url} onClick={() => setLoadMedia(true)}>Load image: {file.file_name}</button> : <a key={file.file_url} href={mediaUrl(file.file_url)} target="_blank" rel="noreferrer"><img className="message-image" src={imagePreviewUrl(file.file_url, 640)} alt={file.file_name} loading="lazy" decoding="async" /></a> : file.file_type.startsWith('video/') && settings?.auto_download_videos !== false ? <video className="message-image" key={file.file_url} src={mediaUrl(file.file_url)} controls preload="auto" /> : <a key={file.file_url} href={mediaUrl(file.file_url)} target="_blank" rel="noreferrer" className="attachment-link"><Paperclip size={17} />{file.file_name}</a>)}</>}
      <small className="message-meta">{timeAgo(item.created_at)}{item.is_edited ? ' · edited' : ''}{item.expires_at && !item.is_deleted ? ` · Disappears ${fullTime(item.expires_at)}` : ''}</small>
      {item.reactions?.length ? <div className="message-reactions">{item.reactions.map(reaction => <span key={reaction.id}>{reaction.emoji}</span>)}</div> : null}
      {item.id > 0 && <MessageActions message={item} mine={mine} onReply={() => onReply(item)} />}
    </div>
  </div>
})

export function ChatsPage() {
  const { startCall } = useCall()
  const navigate = useNavigate()
  const current = useAuth(state => state.user)
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const selectedId = Number(params.get('id')) || 0
  const [filter, setFilter] = useState<'all' | 'unread' | 'groups' | 'favourites' | 'archived' | 'locked'>('all')
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null)
  const menuWrap = useRef<HTMLDivElement>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'delete' | 'clear' | 'block'; conv: Conversation } | null>(null)
  const [pinTarget, setPinTarget] = useState<Conversation | null>(null)
  const [pinMode, setPinMode] = useState<'set' | 'unlock' | 'remove'>('unlock')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinError, setPinError] = useState('')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [newChat, setNewChat] = useState(false)
  const [newGroup, setNewGroup] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupMembers, setGroupMembers] = useState<User[]>([])
  const [newSearch, setNewSearch] = useState('')
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const messageInput = useRef<HTMLTextAreaElement>(null)
  const emojiWrap = useRef<HTMLDivElement>(null)
  const optionsWrap = useRef<HTMLDivElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [messageOptionsOpen, setMessageOptionsOpen] = useState(false)
  const [scheduledOpen, setScheduledOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleAt, setScheduleAt] = useState(scheduleDefault)
  const [expirySeconds, setExpirySeconds] = useState(0)
  const [notice, setNotice] = useState('')
  const [readPendingFor, setReadPendingFor] = useState<number | null>(null)
  const [olderByConversation, setOlderByConversation] = useState<Record<number, Message[]>>({})
  const [historyExhausted, setHistoryExhausted] = useState<Set<number>>(() => new Set())
  const [loadingOlder, setLoadingOlder] = useState<number | null>(null)
  const [olderError, setOlderError] = useState('')
  const messageScroll = useRef<HTMLDivElement>(null)
  const lastReadRequest = useRef('')
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: ({ signal }) => api<Conversation[]>('/conversations', { signal }), refetchInterval: 60_000 })
  const settingsQuery = useQuery({ queryKey: ['app-settings'], queryFn: () => api<AccountSettings>('/settings') })
  const selected = conversations.data?.find(conv => conv.id === selectedId)
  const messages = useQuery({ queryKey: ['messages', selectedId], queryFn: ({ signal }) => api<Message[]>(query(`/messages/conversation/${selectedId}`, { limit: 100 }), { signal }), enabled: !!selected && (!selected.is_locked || selected.is_unlocked) })
  const earlier = olderByConversation[selectedId]
  const loadedMessages = useMemo(() => {
    const recent = messages.data || []
    if (!earlier?.length) return recent
    const ids = new Set(recent.map(item => item.id))
    return [...earlier.filter(item => !ids.has(item.id)), ...recent]
  }, [earlier, messages.data])
  const loadOlder = async () => {
    if (!selectedId || loadingOlder !== null || !loadedMessages.length) return
    const conversationId = selectedId
    const oldestId = loadedMessages[0].id
    const element = messageScroll.current
    const oldHeight = element?.scrollHeight || 0
    const oldTop = element?.scrollTop || 0
    setLoadingOlder(conversationId)
    setOlderError('')
    try {
      const rows = await api<Message[]>(query(`/messages/conversation/${conversationId}`, { limit: 100, before_id: oldestId }))
      setOlderByConversation(previous => ({ ...previous, [conversationId]: [
        ...rows.filter(item => !previous[conversationId]?.some(known => known.id === item.id)),
        ...(previous[conversationId] || []),
      ] }))
      if (rows.length < 100) setHistoryExhausted(previous => new Set(previous).add(conversationId))
      requestAnimationFrame(() => { if (element && messageScroll.current === element) element.scrollTop = element.scrollHeight - oldHeight + oldTop })
    } catch (cause) { setOlderError(cause instanceof Error ? cause.message : 'Could not load earlier messages.') }
    finally { setLoadingOlder(null) }
  }
  const scheduled = useQuery({ queryKey: ['scheduled-messages'], queryFn: () => api<ScheduledMessage[]>('/messages/scheduled'), enabled: !!selected && (!selected.is_locked || selected.is_unlocked) })
  const pendingHere = scheduled.data?.filter(item => item.conversation_id === selectedId) || []
  const users = useQuery({ queryKey: ['people-search', newSearch], queryFn: ({ signal }) => api<User[]>(query('/users/search', { q: newSearch }), { signal }), enabled: (newChat || newGroup) && newSearch.trim().length > 0 })
  const send = useMutation({ mutationFn: async (input: SendInput) => {
    const uploaded = input.file ? await upload(input.file) : null
    return api<Message>('/messages', { method: 'POST', body: { conversation_id: input.conversationId, content: input.content, reply_to_id: input.reply?.id, expires_in_seconds: input.expiresInSeconds || undefined, message_type: uploaded ? uploaded.file_type.startsWith('image/') ? 'IMAGE' : 'FILE' : 'TEXT', attachments: uploaded ? [uploaded] : undefined } })
  }, onMutate: input => {
    if (input.file) return null
    const tempId = -(Date.now() + Math.floor(Math.random() * 1000))
    const pending: Message = { id: tempId, conversation_id: input.conversationId, sender_id: current?.id || 0,
      content: input.content, message_type: 'TEXT', created_at: new Date().toISOString(),
      is_deleted: false, is_edited: false, status: 'SENT', attachments: [], sender: current,
      reply_to_id: input.reply?.id, reply_to: input.reply ? { id: input.reply.id,
        sender_name: input.reply.sender?.display_name || input.reply.sender?.username,
        content: input.reply.content.slice(0, 100) } : null }
    client.setQueryData<Message[]>(['messages', input.conversationId], rows => rows && [...rows, pending])
    setDraft('')
    setReplyTo(null)
    return { tempId }
  }, onSuccess: (sent, input, context) => {
    client.setQueryData<Message[]>(['messages', input.conversationId], rows => {
      if (!rows) return rows
      const withoutPending = rows.filter(row => row.id !== context?.tempId && row.id !== sent.id)
      return [...withoutPending, sent]
    })
    if (input.file) { setDraft(value => value === input.content ? '' : value); setAttachment(null); setReplyTo(null) }
    setError(''); setNotice('')
    void client.invalidateQueries({ queryKey: ['conversations'] })
    if (selectedId === input.conversationId) requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }))
  }, onError: (cause, input, context) => {
    if (context?.tempId) client.setQueryData<Message[]>(['messages', input.conversationId], rows => rows?.filter(row => row.id !== context.tempId))
    setDraft(value => value || input.content)
    if (input.reply) setReplyTo(input.reply)
    setError(cause.message)
  } })
  const schedule = useMutation({ mutationFn: () => api<ScheduledMessage>('/messages/scheduled', { method: 'POST', body: { conversation_id: selectedId, content: draft.trim(), reply_to_id: replyTo?.id, expires_in_seconds: expirySeconds || undefined, send_at: new Date(scheduleAt).toISOString() } }), onSuccess: () => { setDraft(''); setReplyTo(null); setScheduleOpen(false); setError(''); setNotice(`Message scheduled for ${fullTime(new Date(scheduleAt).toISOString())}.`); void client.invalidateQueries({ queryKey: ['scheduled-messages'] }) }, onError: cause => setError(cause.message) })
  const cancelScheduled = useMutation({ mutationFn: (id: number) => api(`/messages/scheduled/${id}`, { method: 'DELETE' }), onSuccess: () => { setError(''); setNotice('Scheduled message canceled.'); void client.invalidateQueries({ queryKey: ['scheduled-messages'] }) }, onError: cause => setError(cause.message) })
  const start = useMutation({ mutationFn: (recipient_id: number) => api<Conversation>('/conversations/direct', { method: 'POST', body: { recipient_id } }), onSuccess: conv => { void client.invalidateQueries({ queryKey: ['conversations'] }); setParams({ id: String(conv.id) }); setNewChat(false); setNewSearch('') }, onError: cause => setError(cause.message) })
  const createGroup = useMutation({ mutationFn: () => api<Conversation>('/groups', { method: 'POST', body: { name: groupName, member_ids: groupMembers.map(person => person.id) } }), onSuccess: conv => { void client.invalidateQueries({ queryKey: ['conversations'] }); setParams({ id: String(conv.id) }); setNewGroup(false); setGroupName(''); setGroupMembers([]); setNewSearch('') }, onError: (cause: Error) => setError(cause.message) })
  const [menuPending, setMenuPending] = useState(false)
  const [menuError, setMenuError] = useState('')
  const openPin = (conv: Conversation, mode: 'set' | 'unlock' | 'remove') => {
    setPinTarget(conv); setPinMode(mode); setPin(''); setPinConfirm(''); setPinError(''); setMenuOpenId(null)
  }
  const updateChatPreference = async (conv: Conversation, changes: Record<string, boolean>, label: string) => {
    setMenuPending(true); setMenuError('')
    try {
      await api(`/conversations/${conv.id}/preferences`, { method: 'PATCH', body: changes })
      await client.invalidateQueries({ queryKey: ['conversations'] })
      void client.invalidateQueries({ queryKey: ['app-settings'] })
      setNotice(label); setMenuOpenId(null)
    } catch (cause) { setMenuError(cause instanceof Error ? cause.message : 'Could not update chat.') }
    finally { setMenuPending(false) }
  }
  const performConfirmedAction = async () => {
    if (!confirmAction || menuPending) return
    const { conv, type } = confirmAction
    setMenuPending(true); setMenuError('')
    try {
      if (type === 'block' && conv.other_user) await api(`/users/${conv.other_user.id}/block`, { method: 'POST' })
      else if (type === 'clear') await api(`/conversations/${conv.id}/clear`, { method: 'POST' })
      else if (type === 'delete') await api(`/conversations/${conv.id}`, { method: 'DELETE' })
      client.removeQueries({ queryKey: ['messages', conv.id], exact: true })
      setOlderByConversation(previous => { const next = { ...previous }; delete next[conv.id]; return next })
      if (selectedId === conv.id && type !== 'clear') setParams({})
      await client.invalidateQueries({ queryKey: ['conversations'] })
      setNotice(type === 'block' ? 'Account blocked.' : type === 'clear' ? 'Chat cleared for you.' : 'Chat removed from your list.')
      setConfirmAction(null)
    } catch (cause) { setMenuError(cause instanceof Error ? cause.message : 'Could not update chat.') }
    finally { setMenuPending(false) }
  }
  const submitChatPin = async (event: FormEvent) => {
    event.preventDefault()
    if (!pinTarget || menuPending) return
    if (!/^\d{4}$/.test(pin)) { setPinError('Enter exactly four digits.'); return }
    if (pinMode === 'set' && pin !== pinConfirm) { setPinError('The PINs do not match.'); return }
    setMenuPending(true); setPinError('')
    try {
      await api(`/conversations/${pinTarget.id}/${pinMode === 'set' ? 'lock' : pinMode === 'remove' ? 'lock' : 'unlock'}`, {
        method: pinMode === 'remove' ? 'DELETE' : 'POST', body: { pin },
      })
      client.removeQueries({ queryKey: ['messages', pinTarget.id], exact: true })
      if (pinMode === 'set' && selectedId === pinTarget.id) setParams({})
      await client.invalidateQueries({ queryKey: ['conversations'] })
      if (pinMode === 'unlock') setParams({ id: String(pinTarget.id) })
      setNotice(pinMode === 'set' ? 'Chat locked.' : pinMode === 'remove' ? 'Chat lock removed.' : 'Chat unlocked for 15 minutes.')
      setPinTarget(null); setPin(''); setPinConfirm('')
    } catch (cause) { setPinError(cause instanceof Error ? cause.message : 'Could not update chat lock.') }
    finally { setMenuPending(false) }
  }
  const relockChat = async (conv: Conversation) => {
    setMenuPending(true); setMenuError('')
    try {
      await api(`/conversations/${conv.id}/relock`, { method: 'POST' })
      client.removeQueries({ queryKey: ['messages', conv.id], exact: true })
      if (selectedId === conv.id) setParams({})
      await client.invalidateQueries({ queryKey: ['conversations'] })
      setMenuOpenId(null); setNotice('Chat locked again.')
    } catch (cause) { setMenuError(cause instanceof Error ? cause.message : 'Could not lock chat.') }
    finally { setMenuPending(false) }
  }
  useEffect(() => { if (selectedId && messages.data) bottom.current?.scrollIntoView() }, [selectedId, messages.data?.length])
  useEffect(() => {
    if (!selectedId || !messages.data || (selected?.is_locked && !selected.is_unlocked)) return
    const lastIncomingId = [...messages.data].reverse().find(item => item.sender_id !== current?.id)?.id || 0
    const requestKey = `${selectedId}:${lastIncomingId}`
    if (lastReadRequest.current === requestKey) return
    lastReadRequest.current = requestKey
    setReadPendingFor(selectedId)
    void api('/messages/read', { method: 'POST', body: { conversation_id: selectedId } })
      .then(() => {
        client.setQueryData<Conversation[]>(['conversations'], rows => rows?.map(row => row.id === selectedId ? { ...row, unread_count: 0 } : row))
        void client.invalidateQueries({ queryKey: ['conversations'] })
        setReadPendingFor(value => value === selectedId ? null : value)
      })
      .catch(() => { lastReadRequest.current = ''; setReadPendingFor(value => value === selectedId ? null : value) })
  }, [selectedId, messages.data, current?.id, client, selected?.is_locked, selected?.is_unlocked])
  useEffect(() => {
    if (!emojiOpen) return
    const closeOutside = (event: PointerEvent) => { if (!emojiWrap.current?.contains(event.target as Node)) setEmojiOpen(false) }
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setEmojiOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape) }
  }, [emojiOpen])
  useEffect(() => {
    if (!messageOptionsOpen) return
    const closeOutside = (event: PointerEvent) => { if (!optionsWrap.current?.contains(event.target as Node)) setMessageOptionsOpen(false) }
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMessageOptionsOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape) }
  }, [messageOptionsOpen])
  useEffect(() => {
    if (menuOpenId === null) return
    const closeOutside = (event: PointerEvent) => { if (!menuWrap.current?.contains(event.target as Node)) setMenuOpenId(null) }
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpenId(null) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape) }
  }, [menuOpenId])
  useEffect(() => { setEmojiOpen(false); setMessageOptionsOpen(false); setScheduledOpen(false); setScheduleOpen(false); setExpirySeconds(0); setReplyTo(null); setNotice('') }, [selectedId])
  const insertEmoji = (emoji: string) => {
    const input = messageInput.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? draft.length
    setDraft(value => value.slice(0, start) + emoji + value.slice(end))
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length) })
  }
  const visible = conversations.data?.filter(conv => {
    if (filter === 'archived') return !!conv.is_archived && displayName(conv).toLowerCase().includes(search.toLowerCase())
    if (filter === 'locked') return !!conv.is_locked && displayName(conv).toLowerCase().includes(search.toLowerCase())
    if (conv.is_archived || (conv.is_locked && !conv.is_unlocked)) return false
    if (filter === 'unread' && !conv.unread_count) return false
    if (filter === 'groups' && conv.type !== 'GROUP') return false
    if (filter === 'favourites' && !conv.is_favourite) return false
    return displayName(conv).toLowerCase().includes(search.toLowerCase())
  }) || []
  const unreadConversations = conversations.data?.filter(conv => !conv.is_archived && (!conv.is_locked || conv.is_unlocked) && conv.unread_count > 0).length || 0
  const onSend = (event: FormEvent) => { event.preventDefault(); if (draft.trim() || attachment) send.mutate({ conversationId: selectedId, content: draft, file: attachment, reply: replyTo, expiresInSeconds: expirySeconds }) }
  return <Shell active="Chats">
    <div className={`chat-layout ${selectedId ? 'has-selection' : ''}`}>
      <section className="chat-list" aria-label="Conversations"><header className="chat-list-header"><strong className="chat-account-title">{current?.username || 'Messages'}</strong><button className="icon-button" aria-label="Create group" title="Create group" onClick={() => { setNewGroup(true); setNewSearch('') }}><Users size={23} /></button></header><div className="chat-title-row"><h1>Messages <span>{conversations.data?.length || 0}</span></h1><button className="icon-button" onClick={() => setNewChat(true)} aria-label="New conversation"><Plus size={23} /></button></div><label className="search-field"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></label><div className="chat-filters" role="group" aria-label="Filter conversations">{(['all', 'unread', 'groups', 'favourites', 'archived', 'locked'] as const).map(item => <button type="button" aria-pressed={filter === item} key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All chats' : item === 'unread' ? 'Unread' : item === 'groups' ? 'Groups' : item === 'favourites' ? 'Favourites' : item === 'archived' ? 'Archived' : 'Locked'}{item === 'unread' && unreadConversations > 0 && <span className="filter-count">{unreadConversations}</span>}</button>)}</div>
        {menuError && <div className="chat-list-error" role="alert">{menuError}<button type="button" onClick={() => setMenuError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
        <div className="conversation-scroll">{conversations.isPending && <div className="loading-list">Loading conversations…</div>}{conversations.error && <ErrorBox error={conversations.error} retry={() => void conversations.refetch()} />}{conversations.data && (visible.length ? visible.map(conv => <div key={conv.id} className="conversation-item" ref={menuOpenId === conv.id ? menuWrap : undefined}>
          <button type="button" className={`conversation-row ${conv.id === selectedId ? 'selected' : ''}`} onClick={() => { setParams({ id: String(conv.id) }); if (conv.is_locked && !conv.is_unlocked) openPin(conv, 'unlock') }}>
            {conv.is_locked && !conv.is_unlocked ? <span className="conversation-locked-avatar"><Lock size={22} /></span> : <Avatar user={displayAvatar(conv)} size="lg" />}
            <span className="conversation-summary"><span className="conversation-line"><strong>{displayName(conv)}</strong><time>{conv.is_locked && !conv.is_unlocked ? '' : timeAgo(conv.last_message?.created_at || conv.updated_at)}</time></span><span className="conversation-line"><small>{conv.is_locked && !conv.is_unlocked ? 'Enter PIN to open' : conv.last_message?.content || (conv.type === 'GROUP' ? 'Group conversation' : 'Start a conversation')}</small>{conv.unread_count > 0 && conv.id !== readPendingFor && <b className="unread-dot">{conv.unread_count}</b>}</span></span>
          </button>
          <button type="button" className="conversation-more" aria-label={`Options for ${displayName(conv)}`} aria-expanded={menuOpenId === conv.id} onPointerDown={event => { event.stopPropagation(); setMenuError(''); setMenuOpenId(value => value === conv.id ? null : conv.id) }} onClick={event => { if (event.detail === 0) { setMenuError(''); setMenuOpenId(value => value === conv.id ? null : conv.id) } }}><MoreHorizontal size={19} /></button>
          {menuOpenId === conv.id && <div className="conversation-menu" role="menu" aria-label={`Options for ${displayName(conv)}`}>
            {conv.is_locked && !conv.is_unlocked ? <button role="menuitem" onClick={() => openPin(conv, 'unlock')}><Unlock size={16} /> Unlock chat</button> : <>
              <button role="menuitem" disabled={menuPending} onClick={() => void updateChatPreference(conv, { is_pinned: !conv.is_pinned }, conv.is_pinned ? 'Chat unpinned.' : 'Chat pinned.')}><Pin size={16} /> {conv.is_pinned ? 'Unpin chat' : 'Pin chat'}</button>
              <button role="menuitem" disabled={menuPending} onClick={() => void updateChatPreference(conv, { is_favourite: !conv.is_favourite }, conv.is_favourite ? 'Removed from favourites.' : 'Added to favourites.')}><Heart size={16} /> {conv.is_favourite ? 'Remove favourite' : 'Add to favourites'}</button>
              <button role="menuitem" disabled={menuPending} onClick={() => void updateChatPreference(conv, { mute_messages: !conv.is_muted }, conv.is_muted ? 'Message alerts on.' : 'Message alerts muted.')}><BellOff size={16} /> {conv.is_muted ? 'Unmute messages' : 'Mute messages'}</button>
              {conv.type === 'DIRECT' && <button role="menuitem" disabled={menuPending} onClick={() => void updateChatPreference(conv, { mute_calls: !conv.mute_calls }, conv.mute_calls ? 'Calls unmuted.' : 'Calls muted.')}><PhoneOff size={16} /> {conv.mute_calls ? 'Unmute calls' : 'Mute calls'}</button>}
              <button role="menuitem" disabled={menuPending} onClick={() => void updateChatPreference(conv, { is_archived: !conv.is_archived }, conv.is_archived ? 'Chat restored from archive.' : 'Chat archived.')}><Archive size={16} /> {conv.is_archived ? 'Unarchive chat' : 'Archive chat'}</button>
              {conv.type === 'DIRECT' && conv.other_user ? <button role="menuitem" onClick={() => { setMenuOpenId(null); navigate(`/profile/${conv.other_user!.id}`) }}><UserRound size={16} /> View profile</button> : <button role="menuitem" onClick={() => { setMenuOpenId(null); setParams({ id: String(conv.id) }); setDetailsOpen(true) }}><Users size={16} /> Group details</button>}
              {conv.is_locked ? <><button role="menuitem" disabled={menuPending} onClick={() => void relockChat(conv)}><Lock size={16} /> Lock now</button><button role="menuitem" onClick={() => openPin(conv, 'remove')}><Unlock size={16} /> Remove chat lock</button></> : <button role="menuitem" onClick={() => openPin(conv, 'set')}><Lock size={16} /> Lock chat</button>}
              <span className="conversation-menu-divider" />
              <button role="menuitem" onClick={() => { setConfirmAction({ type: 'clear', conv }); setMenuOpenId(null); setMenuError('') }}><Eraser size={16} /> Clear chat</button>
              {conv.type === 'DIRECT' && conv.other_user && <button role="menuitem" onClick={() => { setConfirmAction({ type: 'block', conv }); setMenuOpenId(null); setMenuError('') }}><Ban size={16} /> Block account</button>}
            </>}
            <button role="menuitem" className="danger" onClick={() => { setConfirmAction({ type: 'delete', conv }); setMenuOpenId(null); setMenuError('') }}><Trash2 size={16} /> Delete chat for me</button>
          </div>}
        </div>) : <Empty title="No conversations">Try another search or start a new chat.</Empty>)}</div>
        <button className="chat-fab" onClick={() => setNewChat(true)} aria-label="New conversation"><Plus size={27} /></button>
      </section>
      <section className="chat-detail" aria-label="Message thread">
        {selected?.is_locked && !selected.is_unlocked ? <div className="chat-welcome chat-locked-panel"><Lock size={48} /><h2>This chat is locked</h2><p>Enter your four-digit PIN to view this conversation.</p><button className="button primary" onClick={() => openPin(selected, 'unlock')}>Unlock chat</button></div> : selected ? <>
          <header className="chat-detail-header">
            <button className="icon-button mobile-back" onClick={() => setParams({})} aria-label="Back to chats"><ArrowLeft size={23} /></button>
            <Avatar user={displayAvatar(selected)} />
            <div className="chat-contact"><strong>{displayName(selected)}</strong><small>{selected.type === 'GROUP' ? 'Group conversation' : selected.other_user?.username ? `@${selected.other_user.username}` : 'Direct message'}</small></div>
            <button className="icon-button scheduled-toggle" onClick={() => setScheduledOpen(value => !value)} aria-label="Scheduled messages" aria-expanded={scheduledOpen} title="Scheduled messages"><CalendarClock size={21} />{pendingHere.length > 0 && <span className="scheduled-count">{pendingHere.length}</span>}</button>
            {selected.type === 'DIRECT' && selected.other_user && <><button className="icon-button" onClick={() => void startCall(selected.other_user!, 'audio')} aria-label="Voice call"><Phone size={21} /></button><button className="icon-button" onClick={() => void startCall(selected.other_user!, 'video')} aria-label="Video call"><Video size={21} /></button></>}
            {selected.type === 'GROUP' ? <button className="icon-button" aria-label="Group details" onClick={() => setDetailsOpen(true)}><Info size={22} /></button> : selected.other_user && <Link className="icon-button" to={`/profile/${selected.other_user.id}`} aria-label="View profile"><Info size={22} /></Link>}
          </header>
          {scheduledOpen && <div className="scheduled-panel" role="region" aria-label="Scheduled messages"><div className="scheduled-panel-head"><strong>Scheduled messages</strong><button className="icon-button" onClick={() => setScheduledOpen(false)} aria-label="Close scheduled messages"><X size={18} /></button></div>{scheduled.isPending && <p>Loading scheduled messages…</p>}{scheduled.error && <p role="alert">Could not load scheduled messages.</p>}{!scheduled.isPending && !scheduled.error && pendingHere.length === 0 && <p>No messages scheduled for this chat.</p>}{pendingHere.map(item => <div className="scheduled-item" key={item.id}><span><strong>{item.content}</strong><small>{fullTime(item.send_at)}{item.expires_in_seconds ? ` · Disappears ${disappearingOptions.find(option => option.value === item.expires_in_seconds)?.label.toLowerCase() || 'after sending'}` : ''}</small></span><button onClick={() => cancelScheduled.mutate(item.id)} disabled={cancelScheduled.isPending}>Cancel</button></div>)}</div>}
          <div className="message-scroll" ref={messageScroll}>
            {messages.isPending && <div className="loading-list">Loading messages…</div>}
            {messages.error && <ErrorBox error={messages.error} retry={() => void messages.refetch()} />}
            {messages.data && <>{messages.data.length >= 100 && !historyExhausted.has(selectedId) && <button className="load-link" onClick={() => void loadOlder()} disabled={loadingOlder !== null}>{loadingOlder === selectedId ? 'Loading earlier messages…' : 'Load earlier messages'}</button>}{olderError && <p className="inline-error" role="alert">{olderError}</p>}{loadedMessages.length ? loadedMessages.map((item, index) => <Fragment key={item.id}>
              {(index === 0 || threadDay(loadedMessages[index - 1].created_at) !== threadDay(item.created_at)) && <div className="message-date-divider"><time dateTime={item.created_at}>{threadTime(item.created_at)}</time></div>}
              <ChatMessage item={item} selected={selected} currentId={current?.id} onReply={setReplyTo} settings={settingsQuery.data} />
            </Fragment>) : <Empty title="Say hello">Your conversation starts here.</Empty>}</>}
            <div ref={bottom} />
          </div>
          <form className="message-composer" onSubmit={onSend}>
            {expirySeconds > 0 && <div className="composer-expiry"><Timer size={15} /> Messages disappear {disappearingOptions.find(option => option.value === expirySeconds)?.label.toLowerCase().replace(/^after /, '')} after sending <button type="button" onClick={() => setExpirySeconds(0)} aria-label="Turn off disappearing messages"><X size={15} /></button></div>}
            <div className="composer-row"><div className="composer-field">
              <div className="emoji-anchor" ref={emojiWrap}><button type="button" className="composer-icon" aria-label="Choose emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(value => !value)}><Smile size={23} /></button>{emojiOpen && <EmojiPicker onSelect={insertEmoji} />}</div>
              {replyTo && <div className="file-chip">Replying to {replyTo.sender?.display_name || replyTo.sender?.username || 'message'}<button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
              {attachment && <div className="file-chip">{attachment.name}<button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X size={14} /></button></div>}
              <textarea ref={messageInput} rows={1} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && (settingsQuery.data?.enter_to_send !== false || event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder="Message..." aria-label="Write a message" />
              <div className="message-options-anchor" ref={optionsWrap}><button type="button" className="composer-icon" aria-label="Message delivery options" aria-expanded={messageOptionsOpen} onClick={() => setMessageOptionsOpen(value => !value)} title="Disappearing and scheduled messages"><Timer size={22} /></button>{messageOptionsOpen && <div className="delivery-menu" role="dialog" aria-label="Message delivery options"><label>Disappearing messages<select aria-label="Disappearing message duration" value={expirySeconds} onChange={event => setExpirySeconds(Number(event.target.value))}>{disappearingOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><p>Applies to messages you send from this chat.</p><button type="button" disabled={!draft.trim() || !!attachment} onClick={() => { setScheduleAt(scheduleDefault()); setScheduleOpen(true); setMessageOptionsOpen(false); setError('') }}><CalendarClock size={17} /> Schedule this message</button>{attachment && <p>Scheduling supports text messages only.</p>}</div>}</div>
              <label className="attach-button composer-icon" title="Attach a file" aria-label="Attach a file"><ImagePlus size={22} /><input type="file" accept="image/*,.pdf,.doc,.docx,.txt,.zip,.mp3,.mp4" onChange={event => setAttachment(event.target.files?.[0] || null)} /></label>
            </div><button className="send-button" disabled={send.isPending || (!draft.trim() && !attachment)} aria-label="Send message"><Send size={20} /></button></div>
            {notice && <div className="chat-notice" role="status">{notice}</div>}
            {error && <div className="inline-error" role="alert">{error}</div>}
          </form>
        </> : <div className="chat-welcome"><MessageCircle size={55} /><h2>Your messages, all in one place.</h2><p>Choose a conversation or say your first hello.</p><button className="button primary" onClick={() => setNewChat(true)}>Start a conversation</button></div>}
      </section>
    </div>
    {pinTarget && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !menuPending) setPinTarget(null) }}><div className="dialog-card chat-pin-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-pin-title"><header><h2 id="chat-pin-title">{pinMode === 'set' ? 'Lock chat' : pinMode === 'remove' ? 'Remove chat lock' : 'Unlock chat'}</h2><button className="icon-button" onClick={() => setPinTarget(null)} disabled={menuPending} aria-label="Close"><X size={21} /></button></header><form className="profile-edit-form" onSubmit={event => void submitChatPin(event)}><p>{pinMode === 'set' ? 'Choose a four-digit PIN for this chat. You will need it to open the conversation.' : pinMode === 'remove' ? 'Enter your PIN to remove the chat lock.' : 'Enter your PIN to unlock this chat for 15 minutes.'}</p><label>Four-digit PIN<input autoFocus type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} required /></label>{pinMode === 'set' && <label>Confirm PIN<input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} value={pinConfirm} onChange={event => setPinConfirm(event.target.value.replace(/\D/g, '').slice(0, 4))} required /></label>}{pinError && <p className="form-error" role="alert">{pinError}</p>}<div className="chat-dialog-actions"><button type="button" className="button secondary" onClick={() => setPinTarget(null)}>Cancel</button><button className="button primary" disabled={menuPending || pin.length !== 4 || (pinMode === 'set' && pinConfirm.length !== 4)}>{menuPending ? 'Working…' : pinMode === 'set' ? 'Lock chat' : pinMode === 'remove' ? 'Remove lock' : 'Unlock chat'}</button></div></form></div></div>}
    {confirmAction && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !menuPending) setConfirmAction(null) }}><div className="dialog-card chat-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-confirm-title"><header><h2 id="chat-confirm-title">{confirmAction.type === 'delete' ? 'Delete chat for you?' : confirmAction.type === 'clear' ? 'Clear this chat?' : 'Block this account?'}</h2><button className="icon-button" onClick={() => setConfirmAction(null)} disabled={menuPending} aria-label="Close"><X size={21} /></button></header><div className="chat-confirm-body"><p>{confirmAction.type === 'delete' ? 'This removes the chat and its current history from your view. New messages may bring it back.' : confirmAction.type === 'clear' ? 'Messages currently in this chat will disappear from your view. Other members keep their copies.' : `@${confirmAction.conv.other_user?.username} will no longer be able to message or call you.`}</p>{menuError && <p className="form-error" role="alert">{menuError}</p>}<div className="chat-dialog-actions"><button className="button secondary" onClick={() => setConfirmAction(null)} disabled={menuPending}>Cancel</button><button className="button primary" onClick={() => void performConfirmedAction()} disabled={menuPending}>{menuPending ? 'Working…' : confirmAction.type === 'delete' ? 'Delete for me' : confirmAction.type === 'clear' ? 'Clear chat' : 'Block account'}</button></div></div></div></div>}
    {scheduleOpen && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setScheduleOpen(false) }}><div className="dialog-card schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-title"><header><h2 id="schedule-title">Schedule message</h2><button className="icon-button" onClick={() => setScheduleOpen(false)} aria-label="Close"><X size={21} /></button></header><form onSubmit={event => { event.preventDefault(); const sendAt = new Date(scheduleAt).getTime(); if (!Number.isFinite(sendAt) || sendAt <= Date.now() + 5_000 || sendAt > Date.now() + 365 * 86400_000) { setError('Choose a time between 5 seconds and one year from now.'); return } schedule.mutate() }}><p className="schedule-preview">{draft.trim()}</p><label>Send on<input type="datetime-local" value={scheduleAt} onChange={event => setScheduleAt(event.target.value)} required /></label><p className="muted">Your message will be sent at this time in your local time zone.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary" disabled={schedule.isPending || !draft.trim()}>{schedule.isPending ? 'Scheduling…' : 'Schedule message'}</button></form></div></div>}
    {detailsOpen && selected?.type === 'GROUP' && <GroupDetails conversation={selected} close={() => setDetailsOpen(false)} left={() => setParams({})} />}
    {newGroup && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setNewGroup(false) }}><div className="dialog-card" role="dialog" aria-modal="true"><header><h2>Create group</h2><button className="icon-button" onClick={() => setNewGroup(false)} aria-label="Close"><X size={21} /></button></header><form className="profile-edit-form" onSubmit={event => { event.preventDefault(); createGroup.mutate() }}><label>Group name<input value={groupName} onChange={event => setGroupName(event.target.value)} required maxLength={100} /></label><label>Find members<input value={newSearch} onChange={event => setNewSearch(event.target.value)} placeholder="Search people" /></label><div className="group-selected">{groupMembers.map(person => <button type="button" key={person.id} onClick={() => setGroupMembers(groupMembers.filter(item => item.id !== person.id))}>{person.display_name || person.username} ×</button>)}</div><div className="group-results">{users.data?.filter(person => person.id !== current?.id && !groupMembers.some(member => member.id === person.id)).map(person => <button type="button" className="person-row" key={person.id} onClick={() => setGroupMembers([...groupMembers, person])}><Avatar user={person} /><span>{person.display_name || person.username}</span></button>)}</div>{error && <p className="form-error">{error}</p>}<button className="button primary" disabled={!groupName.trim() || createGroup.isPending}>Create group</button></form></div></div>}
    {newChat && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setNewChat(false) }}><div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="new-chat-title"><header><h2 id="new-chat-title">New conversation</h2><button className="icon-button" onClick={() => setNewChat(false)} aria-label="Close"><X size={21} /></button></header><div className="new-chat-body"><label className="search-field"><Search size={18} /><input autoFocus value={newSearch} onChange={event => setNewSearch(event.target.value)} placeholder="Search people" aria-label="Search people" /></label>{users.isPending && newSearch && <p className="muted">Searching…</p>}{users.data?.map(person => <button className="person-row" key={person.id} onClick={() => start.mutate(person.id)}><Avatar user={person} /><span><strong>{person.display_name || person.username}</strong><small>@{person.username}</small></span></button>)}{newSearch && users.data?.length === 0 && <p className="muted">No people found.</p>}<div className="group-hint"><Users size={17} /> Need a group? <button onClick={() => { setNewChat(false); setNewGroup(true); setNewSearch('') }}>Create group</button></div>{error && <div className="form-error">{error}</div>}</div></div></div>}
  </Shell>
}
