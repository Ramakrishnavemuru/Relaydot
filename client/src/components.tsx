import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, CircleUserRound, MessageCircle, PlaySquare, Search, House, Bell, Settings, LogOut, Plus, Users, Bookmark, X } from 'lucide-react'
import { useAuth } from './store'
import { imagePreviewUrl } from './api'
import type { User } from './types'

export function Avatar({ user, size = 'md' }: { user?: User | null; size?: 'sm' | 'md' | 'lg' }) {
  const name = user?.display_name || user?.username || 'Member'
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [user?.avatar_url])
  return user?.avatar_url && !failed
    ? <img className={`avatar avatar-${size}`} src={imagePreviewUrl(user.avatar_url, size === 'lg' ? 128 : 96)} alt={`${name} avatar`} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <span className={`avatar avatar-${size} avatar-fallback`} aria-label={`${name} avatar`}>{name[0]?.toUpperCase()}</span>
}

export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return <div className="empty-state">{icon}<h2>{title}</h2>{children && <p>{children}</p>}{action}</div>
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="error-box" role="alert"><strong>Something went wrong</strong><span>{error instanceof Error ? error.message : 'Please try again.'}</span>{retry && <button className="button secondary" onClick={retry}>Try again</button>}</div>
}

export function GlassDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return <dialog ref={ref} className="dialog-card glass-native-dialog" aria-label={title}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
    <header><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>
    {children}
  </dialog>
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
  const [signOutError, setSignOutError] = useState('')
  const signOut = () => { void logout().catch(() => setSignOutError('Sign-out could not be confirmed. Check your connection and try again.')) }
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  return <div className="app-shell">
    <header className="global-header">
      <Link className="global-brand" to="/" aria-label="Relaydot home"><span className="brand-symbol"><MessageCircle size={22} /></span>Relaydot</Link>
      <nav aria-label="Workspace navigation">{nav.slice(0, 4).map(({to, label, icon: Icon}) =>
        <Link key={to} to={to} aria-current={active === label ? 'page' : undefined}><Icon size={19} /><span>{label}</span></Link>
      )}</nav>
      <form className="global-search" role="search" onSubmit={event => { event.preventDefault(); navigate('/explore?q=' + encodeURIComponent(search.trim())) }}>
        <Search size={18} /><input aria-label="Search Relaydot" placeholder="Search people, posts and topics" value={search} onChange={event => setSearch(event.target.value)} />
      </form>
      <Link className="icon-button" to="/notifications" aria-label="Notifications"><Bell size={21} /></Link>
      <details className="account-menu"><summary aria-label="Account menu"><Avatar user={user} size="sm" /><ChevronDown size={16} /></summary>
        <div><Link to="/profile">Your profile</Link><Link to="/settings">Settings</Link><button onClick={signOut}>Sign out</button></div>
      </details>
    </header>
    <a href="#main-content" className="skip-to-main" onClick={event => {
      event.preventDefault()
      document.getElementById('main-content')?.focus()
    }}>Skip to content</a>
    <aside className="desktop-nav" aria-label="Main navigation">
      <Link className="wordmark" to="/" aria-label="Relaydot home">relay<span>.</span></Link>
      <nav>{nav.map(({ to, label, icon: Icon }) => <Link key={to} to={to} title={label} className={active === label ? 'active' : ''} aria-current={active === label ? 'page' : undefined}><Icon size={23} strokeWidth={active === label ? 2.6 : 1.8} />{label}</Link>)}</nav>
      {onCreate && <button className="button primary nav-create" onClick={onCreate}><Plus size={20} /> Create post</button>}
      <div className="nav-spacer" />
      <Link className="nav-extra" to="/communities"><Users size={18} /> Communities</Link>
      <Link className="nav-extra" to="/bookmarks"><Bookmark size={18} /> Bookmarks</Link>
      <Link className={`nav-extra${active === 'Settings' ? ' active' : ''}`} to="/settings" aria-current={active === 'Settings' ? 'page' : undefined}><Settings size={18} /> Settings</Link>
      <button className="nav-extra" onClick={signOut}><LogOut size={18} /> Sign out</button>
      <Link to="/profile" className="nav-account"><Avatar user={user} /><span><strong>{user?.display_name || user?.username}</strong><small>@{user?.username}</small></span></Link>
    </aside>
    <main className="app-main" id="main-content" tabIndex={-1}>{signOutError && <p className="form-error" role="alert">{signOutError}</p>}{children}</main>
    {aside && <aside className="right-column">{aside}</aside>}
    {onCreate && <button className="mobile-create" aria-label="Create post" onClick={onCreate}><Plus size={28} /></button>}
    <nav className="mobile-nav" aria-label="Mobile navigation">{nav.map(({ to, label, icon: Icon }) => <Link key={to} to={to} title={label} className={active === label ? 'active' : ''} aria-current={active === label ? 'page' : undefined}><Icon size={23} strokeWidth={active === label ? 2.6 : 1.8} /><span>{label}</span></Link>)}</nav>
  </div>
}

export function timeAgo(value?: string | null) {
  if (!value) return ''
  const ms = Date.now() - new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime()
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}
