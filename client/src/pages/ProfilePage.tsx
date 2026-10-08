import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Settings, X } from 'lucide-react'
import { api, mediaUrl, query, upload } from '../api'
import { Avatar, Empty, ErrorBox, Shell } from '../components'
import { useAuth } from '../store'
import { PostCard } from './FeedPage'
import type { Page, Post, User } from '../types'

export function ProfilePage() {
  const { id } = useParams()
  const me = useAuth(state => state.user)
  const setUser = useAuth(state => state.setUser)
  const currentId = Number(id) || me?.id || 0
  const mine = currentId === me?.id
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [website, setWebsite] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const profile = useQuery({ queryKey: ['profile', currentId], queryFn: () => api<User>(`/social/profiles/${currentId}`), enabled: !!currentId })
  const posts = useQuery({ queryKey: ['profile-posts', currentId], queryFn: () => api<Page<Post>>(query(`/social/profiles/${currentId}/posts`, { tab: 'posts', limit: 20 })), enabled: !!currentId })
  const follow = useMutation({ mutationFn: () => api(`/social/profiles/${currentId}/follow`, { method: profile.data?.is_following ? 'DELETE' : 'POST' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['profile', currentId] }) })
  const update = useMutation({ mutationFn: async () => {
    const avatar = avatarFile ? await upload(avatarFile) : null
    const cover = coverFile ? await upload(coverFile) : null
    return api<User>('/users/profile', { method: 'PUT', body: { display_name: name, bio, website, ...(avatar && { avatar_url: avatar.file_url }), ...(cover && { cover_url: cover.file_url }) } })
  }, onSuccess: user => { setUser(user); void client.invalidateQueries({ queryKey: ['profile', currentId] }); setAvatarFile(null); setCoverFile(null); setEditing(false) }, onError: cause => setError(cause.message) })
  const submit = (event: FormEvent) => { event.preventDefault(); update.mutate() }
  return <Shell active="Profile"><header className="page-header"><h1>{mine ? 'Your profile' : profile.data?.display_name || 'Profile'}</h1><Link className="header-icon" to="/settings" aria-label="Settings"><Settings size={21} /></Link></header>{profile.isPending && <div className="loading-list">Loading profile…</div>}{profile.error && <ErrorBox error={profile.error} />}{profile.data && <><div className="profile-cover" style={profile.data.cover_url ? { backgroundImage: `url(${mediaUrl(profile.data.cover_url)})` } : undefined} /><div className="profile-info"><Avatar user={profile.data} size="lg" /><div className="profile-top-actions">{mine ? <button className="button secondary" onClick={() => { setName(profile.data.display_name || ''); setBio(profile.data.bio || ''); setWebsite(profile.data.website || ''); setEditing(true) }}>Edit profile</button> : <button className={`button ${profile.data.is_following ? 'secondary' : 'primary'}`} disabled={follow.isPending} onClick={() => follow.mutate()}>{profile.data.is_following ? 'Following' : 'Follow'}</button>}</div><h2>{profile.data.display_name || profile.data.username}</h2><small>@{profile.data.username}</small>{profile.data.bio && <p>{profile.data.bio}</p>}{profile.data.website && <p><a href={profile.data.website} target="_blank" rel="noreferrer">{profile.data.website}</a></p>}<div className="profile-counts"><span><b>{profile.data.posts_count || 0}</b> posts</span><span><b>{profile.data.followers_count || 0}</b> followers</span><span><b>{profile.data.following_count || 0}</b> following</span></div></div><div className="profile-section-title">Posts</div>{posts.isPending && <div className="loading-list">Loading posts…</div>}{posts.error && <ErrorBox error={posts.error} />}{posts.data && (posts.data.items.length ? posts.data.items.map(post => <PostCard key={post.id} post={post} />) : <Empty title="No posts yet">Posts will appear here when shared.</Empty>)}</>}
    {editing && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(false) }}><div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title"><header><h2 id="edit-profile-title">Edit profile</h2><button className="icon-button" onClick={() => setEditing(false)} aria-label="Close"><X size={21} /></button></header><form className="profile-edit-form" onSubmit={submit}><label>Display name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} /></label><label>Bio<textarea value={bio} onChange={event => setBio(event.target.value)} maxLength={500} /></label><label>Website<input type="url" value={website} onChange={event => setWebsite(event.target.value)} /></label><label>Avatar image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setAvatarFile(event.target.files?.[0] || null)} /></label><label>Cover image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setCoverFile(event.target.files?.[0] || null)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save changes'}</button><Link to="/settings">Account settings</Link></form></div></div>}
  </Shell>
}
