import { FormEvent, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Flag, Image as ImageIcon, LockKeyhole, PlaySquare, Settings, X } from 'lucide-react'
import { api, mediaUrl, query, upload } from '../api'
import { Avatar, Empty, ErrorBox, Shell } from '../components'
import { useAuth } from '../store'
import { PostCard } from './FeedPage'
import { ReportDialog } from '../ReportDialog'
import type { Page, Post, Reel, User } from '../types'

type ConnectionsView = 'followers' | 'following' | 'mutuals'

export function ProfilePage() {
  const { id } = useParams()
  const me = useAuth(state => state.user)
  const setUser = useAuth(state => state.setUser)
  const currentId = Number(id) || me?.id || 0
  const mine = currentId === me?.id
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [connectionsView, setConnectionsView] = useState<ConnectionsView | null>(null)
  const [contentTab, setContentTab] = useState<'posts' | 'reels'>('posts')
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [website, setWebsite] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const profile = useQuery({ queryKey: ['profile', currentId], queryFn: () => api<User>(`/social/profiles/${currentId}`), enabled: !!currentId })
  const privateToMe = !!profile.data?.is_private && !mine
  const posts = useQuery({ queryKey: ['profile-posts', currentId], queryFn: () => api<Page<Post>>(query(`/social/profiles/${currentId}/posts`, { tab: 'posts', limit: 20 })), enabled: !!currentId && !privateToMe && contentTab === 'posts' && !!profile.data })
  const reels = useQuery({ queryKey: ['profile-reels', currentId], queryFn: () => api<Page<Reel>>(query('/reels', { creator_id: currentId, limit: 20 })), enabled: !!currentId && !privateToMe && contentTab === 'reels' && !!profile.data })
  const connections = useInfiniteQuery({ queryKey: ['profile-connections', currentId, connectionsView], queryFn: ({ pageParam }) => api<Page<User>>(query(`/social/profiles/${currentId}/${connectionsView}`, { limit: 30, offset: pageParam })), initialPageParam: 0, getNextPageParam: last => last.next_offset ?? undefined, enabled: !!connectionsView && !!profile.data && !privateToMe })
  const people = connections.data?.pages.flatMap(page => page.items) || []
  const follow = useMutation({ mutationFn: () => api(`/social/profiles/${currentId}/follow`, { method: profile.data?.is_following ? 'DELETE' : 'POST' }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['profile', currentId] }); void client.invalidateQueries({ queryKey: ['profile-connections', currentId] }) } })
  const update = useMutation({ mutationFn: async () => {
    const avatar = avatarFile ? await upload(avatarFile) : null
    const cover = coverFile ? await upload(coverFile) : null
    return api<User>('/users/profile', { method: 'PUT', body: { display_name: name, bio, website, ...(avatar && { avatar_url: avatar.file_url }), ...(cover && { cover_url: cover.file_url }) } })
  }, onSuccess: user => { setUser(user); void client.invalidateQueries({ queryKey: ['profile', currentId] }); setAvatarFile(null); setCoverFile(null); setEditing(false) }, onError: cause => setError(cause.message) })
  const submit = (event: FormEvent) => { event.preventDefault(); update.mutate() }

  return <Shell active="Profile"><header className="page-header"><h1>{mine ? 'Your profile' : profile.data?.display_name || 'Profile'}</h1>{mine && <Link className="header-icon" to="/settings" aria-label="Settings"><Settings size={21} /></Link>}</header>
    {profile.isPending && <div className="loading-list">Loading profile…</div>}
    {profile.error && <ErrorBox error={profile.error} />}
    {profile.data && <>
      <div className="profile-cover" style={profile.data.cover_url ? { backgroundImage: `url(${mediaUrl(profile.data.cover_url)})` } : undefined} />
      <div className="profile-info">
        <div className="profile-summary-head"><Avatar user={profile.data} size="lg" /><div className="profile-top-actions">{mine ? <button className="button secondary" onClick={() => { setName(profile.data.display_name || ''); setBio(profile.data.bio || ''); setWebsite(profile.data.website || ''); setEditing(true) }}>Edit profile</button> : <>{!privateToMe && <button className={`button ${profile.data.is_following ? 'secondary' : 'primary'}`} disabled={follow.isPending} onClick={() => follow.mutate()}>{profile.data.is_following ? 'Following' : 'Follow'}</button>}<button className="button secondary" onClick={() => setReportOpen(true)}><Flag size={15} /> Report</button></>}</div></div>
        <h2>{profile.data.display_name || profile.data.username}</h2><small>@{profile.data.username}</small>
        {profile.data.bio && <p>{profile.data.bio}</p>}{profile.data.website && <p><a href={profile.data.website} target="_blank" rel="noreferrer">{profile.data.website}</a></p>}
        {!privateToMe && <div className="profile-counts"><button type="button" onClick={() => setContentTab('posts')}><b>{profile.data.posts_count || 0}</b><span>posts</span></button><button type="button" onClick={() => setConnectionsView('followers')}><b>{profile.data.followers_count || 0}</b><span>followers</span></button><button type="button" onClick={() => setConnectionsView('following')}><b>{profile.data.following_count || 0}</b><span>following</span></button><button type="button" onClick={() => setConnectionsView('mutuals')}><b>{profile.data.mutuals_count || 0}</b><span>mutuals</span></button></div>}
      </div>
      {privateToMe ? <div className="profile-private-state"><LockKeyhole size={28} /><h2>This account is private</h2><p>Only the account owner can see posts, Reels, followers, and following.</p></div> : <>
        <div className="profile-content-tabs" role="tablist" aria-label="Profile content"><button role="tab" aria-selected={contentTab === 'posts'} className={contentTab === 'posts' ? 'active' : ''} onClick={() => setContentTab('posts')}>Posts</button><button role="tab" aria-selected={contentTab === 'reels'} className={contentTab === 'reels' ? 'active' : ''} onClick={() => setContentTab('reels')}>Reels <span>{profile.data.reels_count || 0}</span></button></div>
        {contentTab === 'posts' && <>{posts.isPending && <div className="loading-list">Loading posts…</div>}{posts.error && <ErrorBox error={posts.error} />}{posts.data && (posts.data.items.length ? posts.data.items.map(post => <PostCard key={post.id} post={post} />) : <Empty title="No posts yet" icon={<ImageIcon size={35} />}>Posts will appear here when shared.</Empty>)}</>}
        {contentTab === 'reels' && <>{reels.isPending && <div className="loading-list">Loading Reels…</div>}{reels.error && <ErrorBox error={reels.error} />}{reels.data && (reels.data.items.length ? <div className="profile-reels-grid">{reels.data.items.map(reel => <Link to={`/reels?id=${encodeURIComponent(reel.public_id)}`} className="profile-reel-card" key={reel.public_id}>{reel.thumbnail_url ? <img src={mediaUrl(reel.thumbnail_url)} alt="" loading="lazy" /> : <PlaySquare size={34} />}<span><PlaySquare size={16} />{reel.caption || 'Watch Reel'}</span></Link>)}</div> : <Empty title="No Reels yet" icon={<PlaySquare size={35} />}>Published Reels will appear here.</Empty>)}</>}
      </>}
    </>}
    {connectionsView && !privateToMe && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setConnectionsView(null) }}><div className="dialog-card profile-connections-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-connections-title"><header><h2 id="profile-connections-title">{connectionsView === 'mutuals' ? 'Mutuals' : connectionsView === 'followers' ? 'Followers' : 'Following'}</h2><button className="icon-button" aria-label="Close people list" onClick={() => setConnectionsView(null)}><X size={20} /></button></header>{connectionsView === 'mutuals' && <p className="profile-connections-intro">People you follow who also follow this account.</p>}<div className="profile-connections-list">{connections.isPending && <div className="loading-list">Loading people…</div>}{connections.error && <ErrorBox error={connections.error} retry={() => void connections.refetch()} />}{people.map(person => <Link className="person-row" key={person.id} to={`/profile/${person.id}`} onClick={() => setConnectionsView(null)}><Avatar user={person} /><span><strong>{person.display_name || person.username}</strong><small>@{person.username}</small></span></Link>)}{!connections.isPending && !connections.error && !people.length && <p className="muted">No {connectionsView} yet.</p>}</div>{connections.hasNextPage && <button className="button secondary profile-connections-more" disabled={connections.isFetchingNextPage} onClick={() => void connections.fetchNextPage()}>{connections.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}</div></div>}
    {reportOpen && !mine && <ReportDialog entityType="user" entityId={currentId} onClose={() => setReportOpen(false)} />}
    {editing && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(false) }}><div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title"><header><h2 id="edit-profile-title">Edit profile</h2><button className="icon-button" onClick={() => setEditing(false)} aria-label="Close"><X size={21} /></button></header><form className="profile-edit-form" onSubmit={submit}><label>Display name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} /></label><label>Bio<textarea value={bio} onChange={event => setBio(event.target.value)} maxLength={500} /></label><label>Website<input type="url" value={website} onChange={event => setWebsite(event.target.value)} /></label><label>Avatar image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setAvatarFile(event.target.files?.[0] || null)} /></label><label>Cover image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setCoverFile(event.target.files?.[0] || null)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save changes'}</button><Link to="/settings">Account settings</Link></form></div></div>}
  </Shell>
}
