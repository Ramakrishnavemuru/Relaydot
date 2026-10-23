import { lazy, Suspense, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api'
import { useAuth } from './store'
import { CallProvider } from './calls'
import type { Conversation, Message } from './types'
import { applyAccountSettings, type AccountSettings } from './settings'

function SettingsEffects() {
  const user = useAuth(state => state.user)
  const client = useQueryClient()
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const load = () => { void api<AccountSettings>('/settings').then(settings => {
      if (!cancelled) { client.setQueryData(['app-settings'], settings); applyAccountSettings(settings) }
    }).catch(() => {}) }
    load()
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event?.query.queryKey[0] === 'app-settings') {
        const value = client.getQueryData<AccountSettings>(['app-settings'])
        if (value) applyAccountSettings(value)
      }
    })
    return () => { cancelled = true; unsubscribe() }
  }, [client, user?.id])
  return null
}

const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })))
const RegisterPage = lazy(() => import('./pages/RegisterPage').then(module => ({ default: module.RegisterPage })))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then(module => ({ default: module.ForgotPasswordPage })))
const FeedPage = lazy(() => import('./pages/FeedPage').then(module => ({ default: module.FeedPage })))
const ChatsPage = lazy(() => import('./pages/ChatsPage').then(module => ({ default: module.ChatsPage })))
const ReelsPage = lazy(() => import('./pages/ReelsPage').then(module => ({ default: module.ReelsPage })))
const ExplorePage = lazy(() => import('./pages/ExplorePage').then(module => ({ default: module.ExplorePage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(module => ({ default: module.ProfilePage })))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then(module => ({ default: module.NotificationsPage })))
const PostDetailPage = lazy(() => import('./pages/PostDetailPage').then(module => ({ default: module.PostDetailPage })))
const collections = () => import('./pages/CollectionsPage')
const BookmarksPage = lazy(() => collections().then(module => ({ default: module.BookmarksPage })))
const CommunitiesPage = lazy(() => collections().then(module => ({ default: module.CommunitiesPage })))
const CommunityPage = lazy(() => collections().then(module => ({ default: module.CommunityPage })))
const TopicPage = lazy(() => collections().then(module => ({ default: module.TopicPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })))
const StaffPage = lazy(() => import('./pages/StaffPage').then(module => ({ default: module.StaffPage })))
const StaffAcceptPage = lazy(() => import('./pages/StaffAcceptPage').then(module => ({ default: module.StaffAcceptPage })))
const AppealPage = lazy(() => import('./pages/AppealPage').then(module => ({ default: module.AppealPage })))

function SocketSync() {
  const client = useQueryClient()
  const user = useAuth(state => state.user)
  useEffect(() => {
    if (!user) return
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let stopped = false
    let reconnectAttempt = 0
    let connectedBefore = false
    const connect = () => {
      if (stopped) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${location.host}/ws`)
      socket.onopen = () => {
        reconnectAttempt = 0
        if (connectedBefore) {
          void client.invalidateQueries({ queryKey: ['conversations'], refetchType: 'active' })
          void client.invalidateQueries({ queryKey: ['messages'], refetchType: 'active' })
          void client.invalidateQueries({ queryKey: ['scheduled-messages'], refetchType: 'active' })
          void client.invalidateQueries({ queryKey: ['notifications'], refetchType: 'active' })
        }
        connectedBefore = true
        heartbeat = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: 'ping', data: {} })) }, 25_000)
      }
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data) as { event: string; data?: Record<string, unknown> }
          const type = message.event
          if (['call_invite', 'call_accept', 'call_reject', 'webrtc_offer', 'webrtc_answer', 'ice_candidate', 'call_end'].includes(type)) window.dispatchEvent(new CustomEvent('relay-call', { detail: message }))
          const data = message.data
          const conversationId = Number(data?.conversation_id)
          if (type === 'message' && Number.isInteger(conversationId)) {
            const incoming = data as Message
            client.setQueryData<Message[]>(['messages', conversationId], rows => rows && (
              rows.some(row => row.id === incoming.id) ? rows.map(row => row.id === incoming.id ? incoming : row) : [...rows, incoming]))
          } else if ((type === 'message_edit' || type === 'message_delete' || type === 'reaction' || type === 'read') && Number.isInteger(conversationId)) {
            client.setQueryData<Message[]>(['messages', conversationId], rows => rows?.map(row => {
              if (type === 'read' && Array.isArray(data?.message_ids) && data.message_ids.includes(row.id)) return { ...row, status: 'READ' }
              if (type === 'reaction' && row.id === data?.message_id) return { ...row, reactions: data?.reactions as Message['reactions'] }
              if (row.id !== data?.id) return row
              if (type === 'message_delete') return { ...row, content: 'This message was deleted', is_deleted: true, attachments: [] }
              return { ...row, ...(data as Partial<Message>) }
            }))
          }
          if (['message', 'message_edit', 'message_delete', 'conversation_new', 'conversation_update'].includes(type)) {
            void client.invalidateQueries({ queryKey: ['conversations'] })
          }
          if (type === 'message.scheduled.sent' || type === 'message.scheduled.failed') {
            void client.invalidateQueries({ queryKey: ['scheduled-messages'] })
          }
          if ((type === 'online' || type === 'offline') && data?.user_id) client.setQueryData<Conversation[]>(['conversations'], rows => rows?.map(row =>
            row.other_user && row.other_user.id === data.user_id ? { ...row, other_user: { ...row.other_user, is_online: type === 'online' } } : row))
          if (type === 'social_notification') {
            void client.invalidateQueries({ queryKey: ['notifications'] })
            if (data?.alert === true && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              const title = typeof data.title === 'string' ? data.title : 'Relay notification'
              const body = data.preview === false ? 'Open Relay to view it.' : typeof data.body === 'string' ? data.body : ''
              new Notification(title, { body, tag: `relay-${String(data.id || Date.now())}` })
            }
            if (data?.alert === true && !document.hidden && document.documentElement.dataset.notificationSound !== 'false') {
              try {
                const context = new AudioContext()
                const tone = context.createOscillator()
                const volume = context.createGain()
                tone.frequency.value = 700
                volume.gain.value = .025
                tone.connect(volume).connect(context.destination)
                tone.start()
                tone.stop(context.currentTime + .12)
                tone.onended = () => { void context.close() }
              } catch { /* Browser audio can require prior interaction. */ }
            }
          }
        } catch { /* ignore malformed event */ }
      }
      socket.onclose = event => {
        if (heartbeat) clearInterval(heartbeat)
        if (!stopped && event.code !== 1008) {
          const backoff = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt++, 5))
          timer = setTimeout(connect, backoff + Math.random() * backoff * .25)
        }
      }
    }
    const sendSignal = (event: Event) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify((event as CustomEvent).detail)) }
    const reconnectWhenOnline = () => {
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
      if (timer) clearTimeout(timer)
      connect()
    }
    window.addEventListener('relay-send-signal', sendSignal)
    window.addEventListener('online', reconnectWhenOnline)
    connect()
    return () => { stopped = true; window.removeEventListener('relay-send-signal', sendSignal); window.removeEventListener('online', reconnectWhenOnline); if (timer) clearTimeout(timer); if (heartbeat) clearInterval(heartbeat); socket?.close() }
  }, [client, user])
  return null
}

function Protected() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page-loading">Opening Relay…</div>
  if (!user) return <Navigate to={location.pathname.startsWith('/staff/') ? '/staff/login' : '/login'} replace state={{ from: location.pathname }} />
  if (user.account_state === 'BANNED') return location.pathname === '/appeal' ? <AppealPage /> : <Navigate to="/appeal" replace />
  return <><SettingsEffects /><SocketSync /><CallProvider><Routes>
    <Route path="/" element={<FeedPage />} />
    <Route path="/chats" element={<ChatsPage />} />
    <Route path="/reels" element={<ReelsPage />} />
    <Route path="/explore" element={<ExplorePage />} />
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="/profile/:id" element={<ProfilePage />} />
    <Route path="/notifications" element={<NotificationsPage />} />
    <Route path="/posts/:id" element={<PostDetailPage />} />
    <Route path="/bookmarks" element={<BookmarksPage />} />
    <Route path="/communities" element={<CommunitiesPage />} />
    <Route path="/communities/:id" element={<CommunityPage />} />
    <Route path="/topics/:name" element={<TopicPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="/staff/*" element={<StaffPage />} />
    <Route path="/staff/accept" element={<StaffAcceptPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></CallProvider></>
}

export default function App() {
  const boot = useAuth(state => state.boot)
  const user = useAuth(state => state.user)
  useEffect(() => { void boot() }, [boot])
  useEffect(() => {
    const expired = () => { void boot() }
    window.addEventListener('relay-session-expired', expired)
    return () => window.removeEventListener('relay-session-expired', expired)
  }, [boot])
  return <Suspense fallback={<div className="page-loading">Opening Relay…</div>}><Routes>
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
    <Route path="/staff/login" element={<LoginPage staff />} />
    <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
    <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
    <Route path="/*" element={<Protected />} />
  </Routes></Suspense>
}
