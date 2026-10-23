import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Send, Trash2 } from 'lucide-react'
import { api, query } from '../api'
import { Avatar, Empty, ErrorBox, Shell, timeAgo } from '../components'
import { useAuth } from '../store'
import type { Page, Post, User } from '../types'
import { PostCard } from './FeedPage'

type Comment = { id: number; content: string; author: User; created_at: string; likes_count: number; liked: boolean }

export function PostDetailPage() {
  const id = Number(useParams().id)
  const me = useAuth(state => state.user)
  const navigate = useNavigate()
  const client = useQueryClient()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const post = useQuery({ queryKey: ['post', id], queryFn: () => api<Post>(`/social/posts/${id}`), enabled: !!id })
  const comments = useQuery({ queryKey: ['post-comments', id, offset], queryFn: () => api<Page<Comment>>(query(`/social/posts/${id}/comments`, { limit: 30, offset })), enabled: !!id })
  const add = useMutation({ mutationFn: () => api(`/social/posts/${id}/comments`, { method: 'POST', body: { content: text } }), onSuccess: () => { setText(''); setError(''); void client.invalidateQueries({ queryKey: ['post-comments', id] }); void client.invalidateQueries({ queryKey: ['post', id] }) }, onError: (cause: Error) => setError(cause.message) })
  const remove = useMutation({ mutationFn: (commentId: number) => api(`/social/comments/${commentId}`, { method: 'DELETE' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['post-comments', id] }) })
  const edit = useMutation({ mutationFn: () => api(`/social/posts/${id}`, { method: 'PATCH', body: { content: editText } }), onSuccess: () => { setEditing(false); void client.invalidateQueries({ queryKey: ['post', id] }); void client.invalidateQueries({ queryKey: ['feed'] }) }, onError: (cause: Error) => setError(cause.message) })
  const deletePost = useMutation({ mutationFn: () => api(`/social/posts/${id}`, { method: 'DELETE' }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['feed'] }); navigate('/') }, onError: (cause: Error) => setError(cause.message) })
  return <Shell active="Home"><header className="page-header"><h1>Post</h1><Link to="/">Back to feed</Link></header>
    {post.isPending && <div className="loading-list">Loading post…</div>}{post.error && <ErrorBox error={post.error} />}{post.data && <><PostCard post={post.data} />{post.data.author_id === me?.id && <div className="post-owner-actions"><button className="button secondary" onClick={() => { setEditText(post.data!.content); setEditing(!editing) }}>Edit post</button><button className="button secondary" onClick={() => { if (confirm('Delete this post?')) deletePost.mutate() }}>Delete post</button></div>}{editing && <form className="community-compose" onSubmit={(event: FormEvent) => { event.preventDefault(); edit.mutate() }}><textarea value={editText} onChange={event => setEditText(event.target.value)} /><button className="button primary" disabled={edit.isPending}>Save post</button></form>}</>}
    <div className="profile-section-title">Replies</div>
    {comments.isPending && <div className="loading-list">Loading replies…</div>}{comments.error && <ErrorBox error={comments.error} />}
    {comments.data?.items.map(item => <article className="comment-row post-comment" key={item.id}><Link to={`/profile/${item.author.id}`}><Avatar user={item.author} /></Link><div><strong>{item.author.display_name || item.author.username}</strong><small> · {timeAgo(item.created_at)}</small><p>{item.content}</p></div>{item.author.id === me?.id && <button className="icon-button" title="Delete reply" onClick={() => { if (confirm('Delete this reply?')) remove.mutate(item.id) }}><Trash2 size={16} /></button>}</article>)}
    {comments.data?.items.length === 0 && <Empty title="No replies yet">Start the conversation.</Empty>}
    {comments.data?.next_offset != null && <button className="load-link" onClick={() => setOffset(comments.data!.next_offset!)}>More replies</button>}
    {offset > 0 && <button className="load-link" onClick={() => setOffset(Math.max(0, offset - 30))}>Previous replies</button>}
    <form className="comment-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (text.trim()) add.mutate() }}><input value={text} onChange={event => setText(event.target.value)} placeholder="Write a reply" aria-label="Write a reply" /><button disabled={!text.trim() || add.isPending} aria-label="Reply"><Send size={20} /></button></form>{error && <p className="form-error">{error}</p>}
  </Shell>
}
