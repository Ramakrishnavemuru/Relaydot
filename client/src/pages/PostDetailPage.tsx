import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Pin, Send, Trash2, X } from 'lucide-react'
import { api, query } from '../api'
import { Avatar, Empty, ErrorBox, Shell, timeAgo } from '../components'
import { useAuth } from '../store'
import type { Page, Post, User } from '../types'
import { PostCard } from './FeedPage'

type Comment = { id: number; content: string; author: User; created_at: string; likes_count: number; liked: boolean }

export function PostDetailPage() {
  const slug = useParams().id || ''
  const legacyId = /^[1-9]\d*$/.test(slug) ? Number(slug) : null
  const me = useAuth(state => state.user)
  const navigate = useNavigate()
  const client = useQueryClient()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editText, setEditText] = useState('')
  const post = useQuery({ queryKey: ['post', slug], queryFn: () => api<Post>(legacyId ? `/social/posts/${legacyId}` : `/social/posts/public/${encodeURIComponent(slug)}`), enabled: !!slug, retry: false })
  const id = post.data?.id
  useEffect(() => { if (legacyId && post.data?.public_id) navigate(`/posts/${post.data.public_id}`, { replace: true }) }, [legacyId, post.data?.public_id, navigate])
  const comments = useQuery({ queryKey: ['post-comments', id, offset], queryFn: () => api<Page<Comment>>(query(`/social/posts/${id}/comments`, { limit: 30, offset })), enabled: !!id })
  const add = useMutation({ mutationFn: () => api(`/social/posts/${id}/comments`, { method: 'POST', body: { content: text } }), onSuccess: () => { setText(''); setError(''); void client.invalidateQueries({ queryKey: ['post-comments', id] }); void client.invalidateQueries({ queryKey: ['post', slug] }) }, onError: (cause: Error) => setError(cause.message) })
  const remove = useMutation({ mutationFn: (commentId: number) => api(`/social/comments/${commentId}`, { method: 'DELETE' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['post-comments', id] }) })
  const edit = useMutation({ mutationFn: () => api(`/social/posts/${id}`, { method: 'PATCH', body: { content: editText } }), onSuccess: () => { setEditing(false); void client.invalidateQueries({ queryKey: ['post', slug] }); void client.invalidateQueries({ queryKey: ['feed'] }) }, onError: (cause: Error) => setError(cause.message) })
  const deletePost = useMutation({ mutationFn: () => api(`/social/posts/${id}`, { method: 'DELETE' }), onSuccess: () => { setConfirmDelete(false); void client.invalidateQueries({ queryKey: ['feed'] }); void client.invalidateQueries({ queryKey: ['profile-posts'] }); navigate('/') }, onError: (cause: Error) => setError(cause.message) })
  const profilePin = useMutation({ mutationFn: (pinned: boolean) => api(`/social/posts/${id}/profile-pin`, { method: pinned ? 'DELETE' : 'POST' }), onSuccess: () => { setError(''); void client.invalidateQueries({ queryKey: ['post', slug] }); void client.invalidateQueries({ queryKey: ['profile-posts'] }) }, onError: (cause: Error) => setError(cause.message) })
  return <Shell active="Home"><header className="page-header"><h1>Post</h1><Link to="/">Back to feed</Link></header>
    {post.isPending && <div className="loading-list">Loading post…</div>}{(post.error || !slug) && <Empty title="Post unavailable">The post may have been removed or you may not have access.</Empty>}{post.data && <><PostCard post={post.data} />{post.data.author_id === me?.id && <div className="post-owner-actions"><button className="button secondary" onClick={() => { setEditText(post.data!.content); setEditing(!editing) }}>Edit post</button>{me?.account_type === 'CREATOR' && !post.data.community_id && !post.data.repost_of_id && !post.data.thread_parent_id && <button className="button secondary" disabled={profilePin.isPending} onClick={() => profilePin.mutate(!!post.data?.profile_pinned_at)}><Pin size={16} />{post.data.profile_pinned_at ? 'Unpin from profile' : 'Pin to profile'}</button>}<button className="button secondary" onClick={() => { setError(''); setConfirmDelete(true) }}>Delete post</button></div>}{editing && <form className="community-compose" onSubmit={(event: FormEvent) => { event.preventDefault(); edit.mutate() }}><textarea value={editText} onChange={event => setEditText(event.target.value)} /><button className="button primary" disabled={edit.isPending}>Save post</button></form>}</>}
    {confirmDelete && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !deletePost.isPending) setConfirmDelete(false) }}><div className="dialog-card post-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-post-title" aria-describedby="delete-post-description"><header><h2 id="delete-post-title">Delete post?</h2><button className="icon-button" onClick={() => setConfirmDelete(false)} disabled={deletePost.isPending} aria-label="Close dialog"><X size={20} /></button></header><div className="post-delete-body"><p id="delete-post-description">This post will be removed from Relaydot. This action cannot be undone.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="post-delete-actions"><button className="button secondary" disabled={deletePost.isPending} onClick={() => setConfirmDelete(false)}>Cancel</button><button className="button danger" disabled={deletePost.isPending} onClick={() => deletePost.mutate()}>{deletePost.isPending ? 'Deleting…' : 'Delete post'}</button></div></div></div></div>}
    {post.data && <section className="post-replies" aria-label="Post replies"><div className="profile-section-title">Replies</div>
    {comments.isPending && <div className="loading-list">Loading replies…</div>}{comments.error && <ErrorBox error={comments.error} />}
    {comments.data?.items.map(item => <article className="comment-row post-comment" key={item.id}><Link to={`/profile/${item.author.id}`}><Avatar user={item.author} /></Link><div><strong>{item.author.display_name || item.author.username}</strong><small> · {timeAgo(item.created_at)}</small><p>{item.content}</p></div>{item.author.id === me?.id && <button className="icon-button" title="Delete reply" onClick={() => { if (confirm('Delete this reply?')) remove.mutate(item.id) }}><Trash2 size={16} /></button>}</article>)}
    {comments.data?.items.length === 0 && <Empty title="No replies yet">Start the conversation.</Empty>}
    {comments.data?.next_offset != null && <button className="load-link" onClick={() => setOffset(comments.data!.next_offset!)}>More replies</button>}
    {offset > 0 && <button className="load-link" onClick={() => setOffset(Math.max(0, offset - 30))}>Previous replies</button>}
    <form className="post-reply-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); if (text.trim()) add.mutate() }}><Avatar user={me} size="sm" /><label className="post-reply-field"><span className="sr-only">Write a reply</span><input value={text} onChange={event => setText(event.target.value)} maxLength={2000} placeholder="Write a reply…" aria-label="Write a reply" /></label><button type="submit" disabled={!text.trim() || add.isPending} aria-label={add.isPending ? 'Posting reply' : 'Post reply'}><Send size={18} /><span>{add.isPending ? 'Posting…' : 'Reply'}</span></button></form>{error && <p className="form-error post-reply-error" role="alert">{error}</p>}</section>}
  </Shell>
}
