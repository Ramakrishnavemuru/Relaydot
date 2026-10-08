import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, query } from '../api'
import { Empty, ErrorBox, Shell } from '../components'
import type { Page, Post } from '../types'
import { PostCard } from './FeedPage'

type Community = { id: number; name: string; description: string; member_count: number; my_role?: string | null; conversation_id?: number | null }

export function BookmarksPage() {
  const [offset, setOffset] = useState(0)
  const saved = useQuery({ queryKey: ['bookmarks', offset], queryFn: () => api<Page<Post>>(query('/social/bookmarks', { limit: 20, offset })) })
  return <Shell active="Home"><header className="page-header"><h1>Bookmarks</h1></header>{saved.isPending && <div className="loading-list">Loading saved posts…</div>}{saved.error && <ErrorBox error={saved.error} />}{saved.data?.items.map(post => <PostCard key={post.id} post={post} />)}{saved.data?.items.length === 0 && <Empty title="Nothing saved yet">Bookmark posts to find them here.</Empty>}{saved.data?.next_offset != null && <button className="load-link" onClick={() => setOffset(saved.data!.next_offset!)}>More posts</button>}</Shell>
}

export function TopicPage() {
  const { name = '' } = useParams()
  const [offset, setOffset] = useState(0)
  const posts = useQuery({ queryKey: ['topic', name, offset], queryFn: () => api<Page<Post>>(query(`/social/hashtags/${encodeURIComponent(name)}`, { limit: 20, offset })) })
  return <Shell active="Explore"><header className="page-header"><h1>#{name}</h1></header>{posts.isPending && <div className="loading-list">Loading posts…</div>}{posts.error && <ErrorBox error={posts.error} />}{posts.data?.items.map(post => <PostCard key={post.id} post={post} />)}{posts.data?.items.length === 0 && <Empty title="No posts yet">Posts with this topic will appear here.</Empty>}{posts.data?.next_offset != null && <button className="load-link" onClick={() => setOffset(posts.data!.next_offset!)}>More posts</button>}</Shell>
}

export function CommunitiesPage() {
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const communities = useQuery({ queryKey: ['communities', search], queryFn: () => api<Page<Community>>(query('/social/communities', { q: search, limit: 50 })) })
  const create = useMutation({ mutationFn: () => api<Community>('/social/communities', { method: 'POST', body: { name, description } }), onSuccess: () => { setCreating(false); setName(''); setDescription(''); void client.invalidateQueries({ queryKey: ['communities'] }) }, onError: (cause: Error) => setError(cause.message) })
  return <Shell active="Explore"><header className="page-header"><h1>Communities</h1><button className="button primary" onClick={() => setCreating(true)}>Create</button></header><label className="explore-search"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search communities" /></label>{communities.isPending && <div className="loading-list">Loading communities…</div>}{communities.error && <ErrorBox error={communities.error} />}{communities.data?.items.map(item => <Link className="community-result" key={item.id} to={`/communities/${item.id}`}><strong>{item.name}</strong><p>{item.description}</p><small>{item.member_count} members</small></Link>)}{communities.data?.items.length === 0 && <Empty title="No communities found">Create a space for your people.</Empty>}
    {creating && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreating(false) }}><div className="dialog-card" role="dialog" aria-modal="true"><header><h2>Create community</h2><button className="icon-button" onClick={() => setCreating(false)}>Close</button></header><form className="profile-edit-form" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate() }}><label>Name<input value={name} onChange={event => setName(event.target.value)} required maxLength={100} /></label><label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} required /></label>{error && <p className="form-error">{error}</p>}<button className="button primary" disabled={create.isPending}>Create community</button></form></div></div>}
  </Shell>
}

export function CommunityPage() {
  const id = Number(useParams().id)
  const client = useQueryClient()
  const [text, setText] = useState('')
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const community = useQuery({ queryKey: ['community', id], queryFn: () => api<Community>(`/social/communities/${id}`) })
  const posts = useQuery({ queryKey: ['community-posts', id, offset], queryFn: () => api<Page<Post>>(query(`/social/communities/${id}/posts`, { limit: 20, offset })) })
  const membership = useMutation({ mutationFn: () => api(`/social/communities/${id}/join`, { method: community.data?.my_role ? 'DELETE' : 'POST' }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['community', id] }); void client.invalidateQueries({ queryKey: ['communities'] }) }, onError: (cause: Error) => setError(cause.message) })
  const publish = useMutation({ mutationFn: () => api('/social/posts', { method: 'POST', body: { content: text, community_id: id } }), onSuccess: () => { setText(''); void client.invalidateQueries({ queryKey: ['community-posts', id] }) }, onError: (cause: Error) => setError(cause.message) })
  return <Shell active="Explore"><header className="page-header"><h1>{community.data?.name || 'Community'}</h1><Link to="/communities">All communities</Link></header>{community.error && <ErrorBox error={community.error} />}{community.data && <div className="community-intro"><p>{community.data.description}</p><small>{community.data.member_count} members</small><div><button className="button primary" disabled={membership.isPending} onClick={() => membership.mutate()}>{community.data.my_role ? 'Leave community' : 'Join community'}</button>{community.data.conversation_id && <Link className="button secondary" to={`/chats?id=${community.data.conversation_id}`}>Open group chat</Link>}</div></div>}{error && <p className="form-error">{error}</p>}{community.data?.my_role && <form className="community-compose" onSubmit={(event: FormEvent) => { event.preventDefault(); if (text.trim()) publish.mutate() }}><textarea value={text} onChange={event => setText(event.target.value)} placeholder="Share with this community" /><button className="button primary" disabled={!text.trim() || publish.isPending}>Post</button></form>}{posts.isPending && <div className="loading-list">Loading posts…</div>}{posts.error && <ErrorBox error={posts.error} />}{posts.data?.items.map(post => <PostCard key={post.id} post={post} />)}{posts.data?.items.length === 0 && <Empty title="No posts yet">Start a conversation here.</Empty>}{posts.data?.next_offset != null && <button className="load-link" onClick={() => setOffset(posts.data!.next_offset!)}>More posts</button>}</Shell>
}
