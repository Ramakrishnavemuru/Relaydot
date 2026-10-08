import { FormEvent, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bookmark, Heart, ImagePlus, MessageCircle, MoreHorizontal, Repeat2, Send, Sparkles, X } from 'lucide-react'
import { api, mediaUrl, query, upload } from '../api'
import { Avatar, Empty, ErrorBox, Shell, timeAgo } from '../components'
import { useAuth } from '../store'
import type { Page, Post, Reel } from '../types'
import { StoriesStrip } from '../Stories'

export function PostCard({ post }: { post: Post }) {
  const client = useQueryClient()
  const refresh = () => { for (const key of ['feed', 'post', 'bookmarks', 'profile-posts', 'community-posts', 'topic']) void client.invalidateQueries({ queryKey: [key] }) }
  const react = useMutation({ mutationFn: () => api<Post>(`/social/posts/${post.id}/reaction`, { method: post.my_reaction ? 'DELETE' : 'POST', ...(!post.my_reaction ? { body: { emoji: '❤️' } } : {}) }), onSuccess: refresh })
  const bookmark = useMutation({ mutationFn: () => api<Post>(`/social/posts/${post.id}/bookmark`, { method: post.bookmarked ? 'DELETE' : 'POST' }), onSuccess: refresh })
  const vote = useMutation({ mutationFn: (option_id: number) => api<Post>(`/social/posts/${post.id}/vote`, { method: 'POST', body: { option_id } }), onSuccess: refresh })
  const share = async () => { const url = `${location.origin}/app/posts/${post.id}`; try { await navigator.share({ url }) } catch { await navigator.clipboard?.writeText(url) } }
  return <article className="post-card">
    <div className="post-header"><Link to={`/profile/${post.author_id}`}><Avatar user={post.author} /></Link><div className="post-identity"><Link to={`/profile/${post.author_id}`}><strong>{post.author.display_name || post.author.username}</strong></Link><small>@{post.author.username} · {timeAgo(post.created_at)}</small></div><Link className="post-more" to={`/posts/${post.id}`} aria-label="More post options"><MoreHorizontal size={20} /></Link></div>
    {post.content && <p className="post-copy">{post.content}</p>}
    {post.media_url && (post.media_type === 'VIDEO' ? <video className="post-image" src={mediaUrl(post.media_url)} controls playsInline /> : <img className="post-image" src={mediaUrl(post.media_url)} alt={`Post by ${post.author.display_name || post.author.username}`} loading="lazy" />)}
    {post.original && <div className="post-original"><strong>{post.original.author.display_name || post.original.author.username}</strong><p>{post.original.content}</p></div>}
    {!!post.poll?.length && <div className="post-poll">{post.poll.map(option => <button key={option.id} disabled={!!post.my_vote || vote.isPending} className={post.my_vote === option.id ? 'voted' : ''} onClick={() => vote.mutate(option.id)}>{option.label}{option.votes != null && <span>{option.votes} votes</span>}</button>)}</div>}
    <div className="post-actions"><Link to={`/posts/${post.id}`} aria-label={`Comments: ${post.comments_count}`}><MessageCircle size={20} /><span>{post.comments_count}</span></Link><button disabled={react.isPending} className={post.my_reaction ? 'engaged' : ''} onClick={() => react.mutate()} aria-label={post.my_reaction ? 'Unlike post' : 'Like post'}><Heart size={20} fill={post.my_reaction ? 'currentColor' : 'none'} /><span>{post.likes_count}</span></button><button onClick={() => { void api(`/social/posts/${post.id}/repost`, { method: 'POST', body: {} }).then(() => client.invalidateQueries({ queryKey: ['feed'] })).catch((cause: Error) => alert(cause.message)) }} aria-label={`Repost: ${post.reposts_count}`}><Repeat2 size={20} /><span>{post.reposts_count}</span></button><button disabled={bookmark.isPending} onClick={() => bookmark.mutate()} aria-label={post.bookmarked ? 'Remove bookmark' : 'Bookmark'}><Bookmark size={20} fill={post.bookmarked ? 'currentColor' : 'none'} /></button><button onClick={() => void share()} aria-label="Share"><Send size={20} /></button></div>
  </article>
}

function Compose({ close }: { close: () => void }) {
  const client = useQueryClient()
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [poll, setPoll] = useState<string[]>([])
  const [error, setError] = useState('')
  const mutation = useMutation({ mutationFn: async () => {
    const media = file ? await upload(file) : null
    return api<Post>('/social/posts', { method: 'POST', body: { content, media_url: media?.file_url || null, media_type: file ? file.type === 'image/gif' ? 'GIF' : file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE' : null, poll_options: poll.length ? poll.map(value => value.trim()) : null } })
  }, onSuccess: () => { void client.invalidateQueries({ queryKey: ['feed'] }); close() }, onError: cause => setError(cause.message) })
  const submit = (event: FormEvent) => { event.preventDefault(); if (content.trim() || file || poll.length) mutation.mutate() }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="compose-title"><header><h2 id="compose-title">Create post</h2><button className="icon-button" onClick={close} aria-label="Close"><X size={21} /></button></header><form onSubmit={submit}><textarea autoFocus maxLength={5000} value={content} onChange={event => setContent(event.target.value)} placeholder="What's happening?" aria-label="Post text" />{poll.map((option, index) => <input className="poll-input" key={index} value={option} onChange={event => setPoll(poll.map((value, i) => i === index ? event.target.value : value))} placeholder={`Poll option ${index + 1}`} maxLength={100} required />)}{file && <div className="file-chip">{file.name}<button type="button" onClick={() => setFile(null)} aria-label="Remove attachment"><X size={16} /></button></div>}{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="text-button" onClick={() => setPoll(poll.length ? [] : ['', ''])}>{poll.length ? 'Remove poll' : 'Add poll'}</button>{poll.length > 0 && poll.length < 6 && <button type="button" className="text-button" onClick={() => setPoll([...poll, ''])}>Add option</button>}<label className="file-button"><ImagePlus size={22} /><span>Photo or video</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4" onChange={event => setFile(event.target.files?.[0] || null)} /></label><button className="button primary" disabled={mutation.isPending || (!content.trim() && !file && !poll.length)}>{mutation.isPending ? 'Posting…' : 'Post'}</button></div></form></div></div>
}

export function FeedPage() {
  const user = useAuth(state => state.user)
  const [mode, setMode] = useState<'for_you' | 'following'>('for_you')
  const [compose, setCompose] = useState(false)
  const feed = useInfiniteQuery({ queryKey: ['feed', mode], initialPageParam: 0, queryFn: ({ pageParam }) => api<Page<Post>>(query('/social/feed', { mode, limit: 20, offset: pageParam })), getNextPageParam: page => page.next_offset ?? undefined })
  const reels = useQuery({ queryKey: ['reels', 'for_you'], queryFn: () => api<Page<Reel>>(query('/reels', { mode: 'for_you', limit: 4 })) })
  return <Shell active="Home" onCreate={() => setCompose(true)} aside={<><div className="aside-search"><Sparkles size={19} /> Your space to connect</div><section className="aside-card"><h2>Explore Relay</h2><p>Discover people, moments, and conversations worth following.</p><Link className="button primary" to="/explore">Explore</Link></section><section className="aside-card"><h2>Go deeper</h2><Link to="/communities">Communities →</Link><Link to="/bookmarks">Saved posts →</Link></section></>}>
    <header className="page-header"><h1>Home</h1><Link to="/notifications" className="header-icon" aria-label="Activity"><Heart size={22} /></Link></header>
    <div className="feed-tabs" role="tablist" aria-label="Feed"><button role="tab" aria-selected={mode === 'for_you'} className={mode === 'for_you' ? 'selected' : ''} onClick={() => setMode('for_you')}>For you</button><button role="tab" aria-selected={mode === 'following'} className={mode === 'following' ? 'selected' : ''} onClick={() => setMode('following')}>Following</button></div>
    <StoriesStrip />
    <button className="inline-compose" onClick={() => setCompose(true)}><Avatar user={user} /><span>What's on your mind?</span><ImagePlus size={20} /></button>
    {feed.isPending && <div className="loading-list">Loading your feed…</div>}{feed.error && <ErrorBox error={feed.error} retry={() => void feed.refetch()} />}{feed.data && (feed.data.pages.flatMap(page => page.items).length ? feed.data.pages.flatMap(page => page.items).map(post => <PostCard key={post.id} post={post} />) : <Empty title="Your feed is ready">Share the first thought or follow someone to see more here.</Empty>)}
    {feed.hasNextPage && <button className="load-link" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>{feed.isFetchingNextPage ? 'Loading…' : 'View more posts'}</button>}
    {!!reels.data?.items.length && <section className="feed-reels"><div className="section-heading"><h2>Reels to watch</h2><Link to="/reels">See all</Link></div><div className="reel-preview-strip">{reels.data.items.map(reel => <Link key={reel.public_id} to={`/reels?id=${reel.public_id}`}><img src={mediaUrl(reel.thumbnail_url)} alt={reel.caption || 'Reel'} /><span>@{reel.creator.username}</span></Link>)}</div></section>}
    {compose && <Compose close={() => setCompose(false)} />}
  </Shell>
}
