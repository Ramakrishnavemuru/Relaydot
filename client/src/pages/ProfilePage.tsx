import { FormEvent, useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Archive, Camera, BarChart3, Flag, Image as ImageIcon, LockKeyhole, Pin, PlaySquare, Settings, Share2, X } from 'lucide-react'
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
  const [contentTab, setContentTab] = useState<'main' | 'posts' | 'reels' | 'archive'>('main')
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [website, setWebsite] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [coverPreview, setCoverPreview] = useState('')
  const [error, setError] = useState('')
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview) }, [avatarPreview])
  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview) }, [coverPreview])
  const chooseAvatar = (file: File | null) => { setAvatarFile(file); setAvatarPreview(file ? URL.createObjectURL(file) : '') }
  const chooseCover = (file: File | null) => { setCoverFile(file); setCoverPreview(file ? URL.createObjectURL(file) : '') }
  const closeEditor = () => { setEditing(false); setError(''); chooseAvatar(null); chooseCover(null) }
  const profile = useQuery({ queryKey: ['profile', currentId], queryFn: () => api<User>(`/social/profiles/${currentId}`), enabled: !!currentId })
  const creatorSummary = useQuery({ queryKey: ['creator-profile-summary', currentId], queryFn: () => api<{ metrics: { views: { value: number } } }>('/creator/summary?days=30'), enabled: mine && profile.data?.account_type === 'CREATOR' })
  useEffect(() => { if (currentId && !mine && profile.data) void api(`/creator/profiles/${currentId}/visit`, { method: 'POST' }).catch(() => {}) }, [currentId, mine, profile.data?.id])
  const privateToMe = !!profile.data?.is_private && !mine
  const posts = useQuery({ queryKey: ['profile-posts', currentId], queryFn: () => api<Page<Post>>(query(`/social/profiles/${currentId}/posts`, { tab: 'posts', limit: 20 })), enabled: !!currentId && !privateToMe && ['main', 'posts'].includes(contentTab) && !!profile.data })
  const reels = useQuery({ queryKey: ['profile-reels', currentId], queryFn: () => api<Page<Reel>>(query('/reels', { creator_id: currentId, limit: 20 })), enabled: !!currentId && !privateToMe && contentTab === 'reels' && !!profile.data })
  const mainReels = useQuery({ queryKey: ['profile-reels', currentId, 'main'], queryFn: () => api<Page<Reel>>(query('/reels', { creator_id: currentId, placement: 'main', limit: 20 })), enabled: !!currentId && !privateToMe && contentTab === 'main' && !!profile.data })
  const archivedReels = useQuery({ queryKey: ['profile-reels', currentId, 'archive'], queryFn: () => api<Page<Reel>>(query('/reels', { mode: 'archive', limit: 20 })), enabled: mine && contentTab === 'archive' })
  const mainItems = [
    ...(posts.data?.items || []).map(post => ({ kind: 'post' as const, id: post.id, created: post.created_at, pinned: !!post.profile_pinned_at, pinTime: post.profile_pinned_at || '', post })),
    ...(mainReels.data?.items || []).map(reel => ({ kind: 'reel' as const, id: reel.id, created: reel.published_at || '', pinned: !!reel.pinned, pinTime: reel.pinned_at || '', reel })),
  ].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.pinTime.localeCompare(a.pinTime) || b.created.localeCompare(a.created))
  const connections = useInfiniteQuery({ queryKey: ['profile-connections', currentId, connectionsView], queryFn: ({ pageParam }) => api<Page<User>>(query(`/social/profiles/${currentId}/${connectionsView}`, { limit: 30, offset: pageParam })), initialPageParam: 0, getNextPageParam: last => last.next_offset ?? undefined, enabled: !!connectionsView && !!profile.data && !privateToMe })
  const people = connections.data?.pages.flatMap(page => page.items) || []
  const follow = useMutation({ mutationFn: () => api(`/social/profiles/${currentId}/follow`, { method: profile.data?.is_following ? 'DELETE' : 'POST' }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['profile', currentId] }); void client.invalidateQueries({ queryKey: ['profile-connections', currentId] }) } })
  const update = useMutation({ mutationFn: async () => {
    const avatar = avatarFile ? await upload(avatarFile) : null
    const cover = coverFile ? await upload(coverFile) : null
    return api<User>('/users/profile', { method: 'PUT', body: { display_name: name, bio, website, ...(avatar && { avatar_url: avatar.file_url }), ...(cover && { cover_url: cover.file_url }) } })
  }, onSuccess: user => { setUser(user); void client.invalidateQueries({ queryKey: ['profile', currentId] }); closeEditor() }, onError: cause => setError(cause.message) })
  const submit = (event: FormEvent) => { event.preventDefault(); update.mutate() }

  return <Shell active="Profile"><header className="page-header"><h1>{mine ? 'Your profile' : profile.data?.display_name || 'Profile'}</h1>{mine && <Link className="header-icon" to="/settings" aria-label="Settings"><Settings size={21} /></Link>}</header>
    {profile.isPending && <div className="loading-list">Loading profile…</div>}
    {profile.error && <ErrorBox error={profile.error} />}
    {profile.data && <>
      <div className="profile-cover" style={profile.data.cover_url ? { backgroundImage: `url(${mediaUrl(profile.data.cover_url)})` } : undefined} />
      <div className="profile-info">
        <div className="profile-summary-head"><Avatar user={profile.data} size="lg" /><div className="profile-top-actions">{mine ? <button className="button secondary" onClick={() => { setName(profile.data.display_name || ''); setBio(profile.data.bio || ''); setWebsite(profile.data.website || ''); setEditing(true) }}>Edit profile</button> : <>{!privateToMe && <button className={`button ${profile.data.is_following ? 'secondary' : 'primary'}`} disabled={follow.isPending} onClick={() => follow.mutate()}>{profile.data.is_following ? 'Following' : 'Follow'}</button>}<button className="button secondary" onClick={() => setReportOpen(true)}><Flag size={15} /> Report</button></>}</div></div>
        <h2>{profile.data.display_name || profile.data.username}</h2><small>@{profile.data.username}</small>
        {profile.data.account_type === 'CREATOR' && profile.data.creator_category && <span className="creator-profile-category">{profile.data.creator_category}</span>}
        {profile.data.bio && <p>{profile.data.bio}</p>}{profile.data.website && <p><a href={profile.data.website} target="_blank" rel="noreferrer">{profile.data.website}</a></p>}
        <div className="creator-profile-actions"><button className="button secondary" onClick={() => { const url = `${location.origin}/app/profile/${currentId}`; void (navigator.share ? navigator.share({ url }).catch(() => {}) : navigator.clipboard.writeText(url).catch(() => {})) }}><Share2 size={16} /> Share profile</button>{!mine && profile.data.contact_email && <a className="button secondary" href={`mailto:${profile.data.contact_email}`}>Contact</a>}</div>
        {mine && profile.data.account_type === 'CREATOR' && <Link className="creator-dashboard-entry" to="/professional-dashboard"><span className="creator-dashboard-icon"><BarChart3 size={22} /></span><span><strong>Your Professional Dashboard</strong><small>{creatorSummary.isPending ? 'Loading views…' : creatorSummary.error ? 'Open insights' : `${creatorSummary.data?.metrics.views.value ?? 0} recorded views in the last 30 days`}</small></span><span aria-hidden="true">→</span></Link>}
        {!privateToMe && <div className="profile-counts"><button type="button" onClick={() => setContentTab('posts')}><b>{profile.data.posts_count || 0}</b><span>posts</span></button><button type="button" onClick={() => setConnectionsView('followers')}><b>{profile.data.followers_count || 0}</b><span>followers</span></button><button type="button" onClick={() => setConnectionsView('following')}><b>{profile.data.following_count || 0}</b><span>following</span></button><button type="button" onClick={() => setConnectionsView('mutuals')}><b>{profile.data.mutuals_count || 0}</b><span>mutuals</span></button></div>}
      </div>
      {privateToMe ? <div className="profile-private-state"><LockKeyhole size={28} /><h2>This account is private</h2><p>Only the account owner can see posts, Reels, followers, and following.</p></div> : <>
        <div className="profile-content-tabs" role="tablist" aria-label="Profile content"><button role="tab" aria-selected={contentTab === 'main'} className={contentTab === 'main' ? 'active' : ''} onClick={() => setContentTab('main')}>Main grid</button><button role="tab" aria-selected={contentTab === 'posts'} className={contentTab === 'posts' ? 'active' : ''} onClick={() => setContentTab('posts')}>Posts</button><button role="tab" aria-selected={contentTab === 'reels'} className={contentTab === 'reels' ? 'active' : ''} onClick={() => setContentTab('reels')}>Reels <span>{profile.data.reels_count || 0}</span></button>{mine && <button role="tab" aria-selected={contentTab === 'archive'} className={contentTab === 'archive' ? 'active' : ''} onClick={() => setContentTab('archive')}>Archive</button>}</div>
        {contentTab === 'main' && <>{(posts.isPending || mainReels.isPending) && <div className="loading-list">Loading profile grid…</div>}{posts.error && <ErrorBox error={posts.error} />}{mainReels.error && <ErrorBox error={mainReels.error} />}{!posts.isPending && !mainReels.isPending && (mainItems.length ? <div className="profile-main-grid">{mainItems.map(item => item.kind === 'reel' ? <Link key={`reel-${item.id}`} to={`/reels?id=${encodeURIComponent(item.reel.public_id)}`} className="profile-main-tile">{item.reel.thumbnail_url ? <img src={mediaUrl(item.reel.thumbnail_url)} alt="" loading="lazy" style={{ objectPosition: `${item.reel.cover_crop_x ?? 50}% ${item.reel.cover_crop_y ?? 50}%`, transform: `scale(${item.reel.cover_zoom ?? 1})` }} /> : <PlaySquare size={30} />}<span><PlaySquare size={15} />{item.reel.caption || 'Reel'}</span>{item.pinned && <Pin className="profile-main-pin" size={16} aria-label="Pinned" />}{item.reel.partnership_label && <small>Paid partnership</small>}</Link> : <Link key={`post-${item.id}`} to={`/posts/${item.post.public_id || item.post.id}`} className="profile-main-tile">{item.post.media_url && item.post.media_type === 'IMAGE' ? <img src={mediaUrl(item.post.media_url)} alt="" loading="lazy" /> : <p>{item.post.content || 'Post'}</p>}<span>{item.post.content || 'Post'}</span>{item.pinned && <Pin className="profile-main-pin" size={16} aria-label="Pinned" />}</Link>)}</div> : <Empty title="Nothing on the main grid yet">Published posts and selected Reels appear here.</Empty>)}</>}
        {contentTab === 'posts' && <>{posts.isPending && <div className="loading-list">Loading posts…</div>}{posts.error && <ErrorBox error={posts.error} />}{posts.data && (posts.data.items.length ? posts.data.items.map(post => <PostCard key={post.id} post={post} />) : <Empty title="No posts yet" icon={<ImageIcon size={35} />}>Posts will appear here when shared.</Empty>)}</>}
        {contentTab === 'reels' && <>{reels.isPending && <div className="loading-list">Loading Reels…</div>}{reels.error && <ErrorBox error={reels.error} />}{reels.data && (reels.data.items.length ? <div className="profile-reels-grid">{reels.data.items.map(reel => <Link to={`/reels?id=${encodeURIComponent(reel.public_id)}`} className="profile-reel-card" key={reel.public_id}>{reel.thumbnail_url ? <img src={mediaUrl(reel.thumbnail_url)} alt="" loading="lazy" /> : <PlaySquare size={34} />}<span><PlaySquare size={16} />{reel.caption || 'Watch Reel'}</span></Link>)}</div> : <Empty title="No Reels yet" icon={<PlaySquare size={35} />}>Published Reels will appear here.</Empty>)}</>}
        {contentTab === 'archive' && mine && <>{archivedReels.isPending && <div className="loading-list">Loading archived Reels…</div>}{archivedReels.error && <ErrorBox error={archivedReels.error} />}{archivedReels.data && (archivedReels.data.items.length ? <div className="profile-reels-grid">{archivedReels.data.items.map(reel => <Link to={`/reels?id=${encodeURIComponent(reel.public_id)}`} className="profile-reel-card" key={reel.public_id}>{reel.thumbnail_url ? <img src={mediaUrl(reel.thumbnail_url)} alt="" loading="lazy" /> : <PlaySquare size={34} />}<span><Archive size={16} />{reel.caption || 'Archived Reel'}</span></Link>)}</div> : <Empty title="Archive is empty">Archived Reels appear here for you only.</Empty>)}</>}
      </>}
    </>}
    {connectionsView && !privateToMe && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setConnectionsView(null) }}><div className="dialog-card profile-connections-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-connections-title"><header><h2 id="profile-connections-title">{connectionsView === 'mutuals' ? 'Mutuals' : connectionsView === 'followers' ? 'Followers' : 'Following'}</h2><button className="icon-button" aria-label="Close people list" onClick={() => setConnectionsView(null)}><X size={20} /></button></header>{connectionsView === 'mutuals' && <p className="profile-connections-intro">People you follow who also follow this account.</p>}<div className="profile-connections-list">{connections.isPending && <div className="loading-list">Loading people…</div>}{connections.error && <ErrorBox error={connections.error} retry={() => void connections.refetch()} />}{people.map(person => <Link className="person-row" key={person.id} to={`/profile/${person.id}`} onClick={() => setConnectionsView(null)}><Avatar user={person} /><span><strong>{person.display_name || person.username}</strong><small>@{person.username}</small></span></Link>)}{!connections.isPending && !connections.error && !people.length && <p className="muted">No {connectionsView} yet.</p>}</div>{connections.hasNextPage && <button className="button secondary profile-connections-more" disabled={connections.isFetchingNextPage} onClick={() => void connections.fetchNextPage()}>{connections.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}</div></div>}
    {reportOpen && !mine && <ReportDialog entityType="user" entityId={currentId} onClose={() => setReportOpen(false)} />}
    {editing && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeEditor() }}>
      <div className="dialog-card profile-editor" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">
        <header><div><h2 id="edit-profile-title">Edit profile</h2><p>Update your photo and profile details.</p></div><button className="icon-button" onClick={closeEditor} aria-label="Close"><X size={21} /></button></header>
        <form className="profile-edit-form" onSubmit={submit}>
          <div className="profile-editor-cover" style={coverPreview || profile.data?.cover_url ? { backgroundImage: `url(${coverPreview || mediaUrl(profile.data?.cover_url)})` } : undefined}>
            <span className="profile-editor-cover-label">Cover photo</span>
            <label className="profile-editor-cover-button"><Camera size={17} /> <span>Change cover</span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Change cover photo" onChange={event => chooseCover(event.target.files?.[0] || null)} /></label>
          </div>
          <div className="profile-editor-avatar"><div className="profile-editor-avatar-image">{avatarPreview ? <img src={avatarPreview} alt="New avatar preview" /> : <Avatar user={profile.data} size="lg" />}</div><label><Camera size={16} /> Change photo<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Change profile photo" onChange={event => chooseAvatar(event.target.files?.[0] || null)} /></label></div>
          <div className="profile-editor-fields"><label>Display name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Your name" /><small>{name.length}/100</small></label><label>Bio<textarea value={bio} onChange={event => setBio(event.target.value)} maxLength={500} placeholder="Tell people a little about yourself" /><small>{bio.length}/500</small></label><label>Website<input type="url" value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" /></label>{error && <p className="form-error" role="alert">{error}</p>}</div>
          <footer className="profile-editor-footer"><Link className="profile-editor-settings-link" to="/settings" onClick={closeEditor}><Settings size={17} /> Account settings</Link><div><button type="button" className="button secondary" onClick={closeEditor}>Cancel</button><button className="button primary" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save changes'}</button></div></footer>
        </form>
      </div>
    </div>}
  </Shell>
}
