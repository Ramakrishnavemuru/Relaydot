import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CircleUserRound, MessageCircle, PlaySquare, Search, House, Bell, Settings, LogOut, Plus, Users, Bookmark } from 'lucide-react'
import { useAuth } from './store'
import { mediaUrl } from './api'
import type { User } from './types'

export function Avatar({ user, size = 'md' }: { user?: User | null; size?: 'sm' | 'md' | 'lg' }) {
  const name = user?.display_name || user?.username || 'Member'
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [user?.avatar_url])
  return user?.avatar_url && !failed
    ? <img className={`avatar avatar-${size}`} src={mediaUrl(user.avatar_url)} alt={`${name} avatar`} onError={() => setFailed(true)} />
    : <span className={`avatar avatar-${size} avatar-fallback`} aria-label={`${name} avatar`}>{name[0]?.toUpperCase()}</span>
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><MessageCircle size={35} /><h2>{title}</h2><p>{children}</p>{action}</div>
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="error-box" role="alert"><strong>Something went wrong</strong><span>{error instanceof Error ? error.message : 'Please try again.'}</span>{retry && <button className="button secondary" onClick={retry}>Try again</button>}</div>
}

const nav = [
  { to: '/', label: 'Home', icon: House },
  { to: '/reels', label: 'Reels', icon: PlaySquare },
  { to: '/chats', label: 'Chats', icon: MessageCircle },
  { to: '/explore', label: 'Explore', icon: Search },
  { to: '/notifications', label: 'Activity', icon: Bell },
  { to: '/profile', label: 'Profile', icon: CircleUserRound },
]

export function Shell({ active, children, aside, onCreate }: { active: string; children: ReactNode; aside?: ReactNode; onCreate?: () => void }) {
  const { user, logout } = useAuth()
  return <div className="app-shell">
    <aside className="desktop-nav" aria-label="Main navigation">
      <Link className="wordmark" to="/">relay<span>.</span></Link>
      <nav>{nav.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className={active === label ? 'active' : ''} aria-current={active === label ? 'page' : undefined}><Icon size={23} strokeWidth={active === label ? 2.6 : 1.8} />{label}</Link>)}</nav>
      {onCreate && <button className="button primary nav-create" onClick={onCreate}><Plus size={20} /> Create post</button>}
      <div className="nav-spacer" />
      <Link className="nav-extra" to="/communities"><Users size={18} /> Communities</Link>
      <Link className="nav-extra" to="/bookmarks"><Bookmark size={18} /> Bookmarks</Link>
      <Link className="nav-extra" to="/settings"><Settings size={18} /> Settings</Link>
      <button className="nav-extra" onClick={() => void logout()}><LogOut size={18} /> Sign out</button>
      <Link to="/profile" className="nav-account"><Avatar user={user} /><span><strong>{user?.display_name || user?.username}</strong><small>@{user?.username}</small></span></Link>
    </aside>
    <main className="app-main" id="main-content">{children}</main>
    {aside && <aside className="right-column">{aside}</aside>}
    {onCreate && <button className="mobile-create" aria-label="Create post" onClick={onCreate}><Plus size={28} /></button>}
    <nav className="mobile-nav" aria-label="Mobile navigation">{nav.filter(item => item.label !== 'Activity').map(({ to, label, icon: Icon }) => <Link key={to} to={to} className={active === label ? 'active' : ''} aria-current={active === label ? 'page' : undefined}><Icon size={24} strokeWidth={active === label ? 2.6 : 1.8} /><span>{label}</span></Link>)}</nav>
  </div>
}

export function timeAgo(value?: string | null) {
  if (!value) return ''
  const ms = Date.now() - new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime()
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}
