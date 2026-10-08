import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { getAccessToken } from './api'
import { useAuth } from './store'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { FeedPage } from './pages/FeedPage'
import { ChatsPage } from './pages/ChatsPage'
import { ReelsPage } from './pages/ReelsPage'
import { ExplorePage } from './pages/ExplorePage'
import { ProfilePage } from './pages/ProfilePage'
import { NotificationsPage } from './pages/NotificationsPage'
import { PostDetailPage } from './pages/PostDetailPage'
import { BookmarksPage, CommunitiesPage, CommunityPage, TopicPage } from './pages/CollectionsPage'
import { SettingsPage } from './pages/SettingsPage'
import { CallProvider } from './calls'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'

function SocketSync() {
  const client = useQueryClient()
  const user = useAuth(state => state.user)
  useEffect(() => {
    if (!user) return
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let stopped = false
    const connect = () => {
      const token = getAccessToken()
      if (!token || stopped) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`)
      socket.onopen = () => { heartbeat = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: 'ping', data: {} })) }, 25_000) }
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data) as { event: string; data?: object }
          const type = message.event
          if (['call_invite', 'call_accept', 'call_reject', 'webrtc_offer', 'webrtc_answer', 'ice_candidate', 'call_end'].includes(type)) window.dispatchEvent(new CustomEvent('relay-call', { detail: message }))
          if (['message', 'message_edit', 'message_delete', 'reaction', 'read', 'conversation_new', 'conversation_update'].includes(type)) {
            void client.invalidateQueries({ queryKey: ['conversations'] })
            void client.invalidateQueries({ queryKey: ['messages'] })
          }
          if (type === 'message.scheduled.sent' || type === 'message.scheduled.failed') {
            void client.invalidateQueries({ queryKey: ['scheduled-messages'] })
            void client.invalidateQueries({ queryKey: ['messages'] })
          }
          if (type === 'social_notification') void client.invalidateQueries({ queryKey: ['notifications'] })
        } catch { /* ignore malformed event */ }
      }
      socket.onclose = event => {
        if (heartbeat) clearInterval(heartbeat)
        if (!stopped && event.code !== 1008) timer = setTimeout(connect, 2500)
      }
    }
    const sendSignal = (event: Event) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify((event as CustomEvent).detail)) }
    window.addEventListener('relay-send-signal', sendSignal)
    connect()
    return () => { stopped = true; window.removeEventListener('relay-send-signal', sendSignal); if (timer) clearTimeout(timer); if (heartbeat) clearInterval(heartbeat); socket?.close() }
  }, [client, user])
  return null
}

function Protected() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page-loading">Opening Relay…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <><SocketSync /><CallProvider><Routes>
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
  return <Routes>
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
    <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
    <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
    <Route path="/*" element={<Protected />} />
  </Routes>
}
