import { lazy, Suspense, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api, ApiError } from './api'
import { useAuth } from './store'
import { CallProvider } from './calls'
import type { Conversation, Message } from './types'
import { ErrorBoundary, LoadFailure } from './ErrorBoundary'
import { applyAccountSettings, type AccountSettings } from './settings'
import { useOfflineSync } from './offlineQueue'

function RouteLoading() {
  const [slow, setSlow] = useState(false)
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 15_000); return () => clearTimeout(timer) }, [])
  return slow ? <LoadFailure message="Loading is taking too long. Check your connection and reload." retry={() => location.reload()} /> : <div className="page-loading" role="status">Opening Relaydot…</div>
}

function NetworkStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const [connected, setConnected] = useState(true)
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    const status = (event: Event) => { const detail = (event as CustomEvent<{ open: boolean; blocked?: boolean }>).detail; setConnected(Boolean(detail.open)); setBlocked(Boolean(detail.blocked)) }
    window.addEventListener('online', update); window.addEventListener('offline', update)
    window.addEventListener('relay-socket-status', status)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('relay-socket-status', status) }
  }, [])
  return !online || !connected ? <div className="network-status" role="status">{!online ? 'You’re offline. Reconnect to send messages.' : blocked ? 'Live updates stopped. Check your session or reload.' : 'Live updates disconnected. Reconnecting…'}{blocked && <button className="text-button" onClick={() => location.reload()}>Reload</button>}</div> : null
}

function OfflineSync({ userId }: { userId: number }) {
  useOfflineSync(userId)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>
    const onNotice = (event: Event) => {
      setNotice((event as CustomEvent<string>).detail)
      clearTimeout(timeout)
      timeout = setTimeout(() => setNotice(''), 5000)
    }
    window.addEventListener('relay-offline-queue-toast', onNotice)
    return () => { clearTimeout(timeout); window.removeEventListener('relay-offline-queue-toast', onNotice) }
  }, [])
  return notice ? <div className="offline-toast" role="status">{notice}</div> : null
}

function SettingsEffects() {
  const user = useAuth(state => state.user)
  const client = useQueryClient()
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const load = () => { void client.fetchQuery({ queryKey: ['app-settings'], queryFn: ({ signal }) => api<AccountSettings>('/settings', { signal }), staleTime: 60_000 }).then(settings => {
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
const StaffRecoveryPage = lazy(() => import('./pages/StaffRecoveryPage').then(module => ({ default: module.StaffRecoveryPage })))
const FeedPage = lazy(() => import('./pages/FeedPage').then(module => ({ default: module.FeedPage })))
const ChatsPage = lazy(() => import('./pages/ChatsPage').then(module => ({ default: module.ChatsPage })))
const ReelsPage = lazy(() => import('./pages/ReelsPage').then(module => ({ default: module.ReelsPage })))
const ExplorePage = lazy(() => import('./pages/ExplorePage').then(module => ({ default: module.ExplorePage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(module => ({ default: module.ProfilePage })))
const ProfessionalDashboardPage = lazy(() => import('./pages/ProfessionalDashboardPage').then(module => ({ default: module.ProfessionalDashboardPage })))
const ContentInsightPage = lazy(() => import('./pages/ContentInsightPage').then(module => ({ default: module.ContentInsightPage })))
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
    let lastPong = Date.now()
    let policyClosed = false
    const connect = () => {
      if (stopped || !navigator.onLine || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${location.host}/ws`)
      socket.onopen = () => {
        window.dispatchEvent(new CustomEvent('relay-socket-status', { detail: { open: true } }))
        lastPong = Date.now()
        reconnectAttempt = 0
        if (connectedBefore) {
          void client.invalidateQueries({ queryKey: ['conversations'], refetchType: 'active' })
          void client.invalidateQueries({ queryKey: ['messages'], refetchType: 'active' })
          void client.invalidateQueries({ queryKey: ['scheduled-messages'], refetchType: 'active' })
          void client.invalidateQueries({ queryKey: ['notifications'], refetchType: 'active' })
        }
        connectedBefore = true
        heartbeat = setInterval(() => {
          if (Date.now() - lastPong > 65_000) { socket?.close(); return }
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: 'ping', data: {} }))
        }, 25_000)
      }
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data) as { event: string; data?: Record<string, unknown> }
          const type = message.event
          if (type === 'pong') { lastPong = Date.now(); return }
          if (['call_invite', 'call_accept', 'call_reject', 'call_error', 'webrtc_offer', 'webrtc_answer', 'ice_candidate', 'call_end'].includes(type)) window.dispatchEvent(new CustomEvent('relay-call', { detail: message }))
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
        if (stopped) return
        window.dispatchEvent(new CustomEvent('relay-socket-status', { detail: { open: false, blocked: event.code === 1008 } }))
        if (heartbeat) clearInterval(heartbeat)
        if (event.code === 1008) {
          policyClosed = true
          void api('/auth/me').catch(cause => { if (cause instanceof ApiError && cause.status === 401) void useAuth.getState().boot() })
        }
        if (!stopped && !policyClosed && navigator.onLine) {
          const backoff = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt++, 5))
          timer = setTimeout(connect, backoff + Math.random() * backoff * .25)
        }
      }
    }
    const sendSignal = (event: Event) => {
      const signal = (event as CustomEvent<{ event: string; data: { call_id?: string } }>).detail
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(signal))
      else window.dispatchEvent(new CustomEvent('relay-call', { detail: {
        event: 'call_error', data: { call_id: signal.data.call_id, message: 'Signaling is offline. Reconnect and try again.' },
      } }))
    }
    const reconnectWhenOnline = () => {
      if (policyClosed || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
      if (timer) clearTimeout(timer)
      connect()
    }
    const offline = () => socket?.close()
    const resume = () => { if (document.hidden) return; if (socket?.readyState === WebSocket.OPEN && Date.now() - lastPong > 65_000) socket.close(); else reconnectWhenOnline() }
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('relay-send-signal', sendSignal)
    window.addEventListener('online', reconnectWhenOnline)
    connect()
    return () => { stopped = true; window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', resume); window.removeEventListener('relay-send-signal', sendSignal); window.removeEventListener('online', reconnectWhenOnline); if (timer) clearTimeout(timer); if (heartbeat) clearInterval(heartbeat); socket?.close() }
  }, [client, user?.id])
  return null
}

function Protected() {
  const { user, loading, bootError, boot } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page-loading" role="status">Opening Relaydot…</div>
  if (bootError) return <LoadFailure message={bootError} retry={() => void boot()} />
  if (!user) return <Navigate to={location.pathname.startsWith('/staff/') ? '/staff/login' : '/login'} replace state={{ from: location.pathname }} />
  if (user.account_state === 'BANNED') return location.pathname === '/appeal' ? <AppealPage /> : <Navigate to="/appeal" replace />
  return <><NetworkStatus /><SettingsEffects /><SocketSync /><OfflineSync userId={user.id} /><CallProvider><ErrorBoundary key={location.pathname}><Routes>
    <Route path="/" element={<FeedPage />} />
    <Route path="/chats" element={<ChatsPage />} />
    <Route path="/reels" element={<ReelsPage />} />
    <Route path="/explore" element={<ExplorePage />} />
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="/professional-dashboard" element={<ProfessionalDashboardPage />} />
    <Route path="/professional-dashboard/insights/:kind/:id" element={<ContentInsightPage />} />
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
  </Routes></ErrorBoundary></CallProvider></>
}

export default function App() {
  const boot = useAuth(state => state.boot)
  const user = useAuth(state => state.user)
  useEffect(() => { void boot(); document.documentElement.dataset.appReady = 'true' }, [boot])
  const client = useQueryClient()
  useEffect(() => useAuth.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) { void client.cancelQueries(); client.clear() }
  }), [client])
  useEffect(() => {
    const expired = () => { void boot() }
    window.addEventListener('relay-session-expired', expired)
    return () => window.removeEventListener('relay-session-expired', expired)
  }, [boot])
  return <ErrorBoundary><Suspense fallback={<RouteLoading />}><Routes>
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
    <Route path="/staff/login" element={<LoginPage staff />} />
    <Route path="/staff/forgot-password" element={<StaffRecoveryPage />} />
    <Route path="/staff/reset-password" element={<StaffRecoveryPage reset />} />
    <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
    <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
    <Route path="/*" element={<Protected />} />
  </Routes></Suspense></ErrorBoundary>
}
