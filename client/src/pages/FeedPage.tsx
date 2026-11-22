import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bookmark, Copy, Heart, ImagePlus, MessageCircle, MoreHorizontal, Repeat2, Search, Send, Users, X } from 'lucide-react'
import { api, imagePreviewUrl, mediaUrl, query } from '../api'
import { Avatar, Empty, ErrorBox, Shell, timeAgo } from '../components'
import { useAuth } from '../store'
import type { Conversation, Page, Post, Reel } from '../types'
import { StoriesStrip } from '../Stories'
import { OfflineQueueButton, OfflineQueuePanel, PostComposer } from '../PostComposer'
import type { QueuedPost } from '../offlineQueue'
import { CollaborationManager } from '../CollaborationManager'

export function PostCard({ post }: { post: Post }) {
  const client = useQueryClient()
  const viewerId = useAuth(state => state.user?.id)
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!viewerId || post.author.is_private || viewerId === post.author_id || post.collaborators?.some(user => user.id === viewerId) || !card.current || !('IntersectionObserver' in window)) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let recorded = false
    const observer = new IntersectionObserver(entries => {
      if (recorded) return
      if (entries[0]?.isIntersecting) timer = setTimeout(() => {
        recorded = true; observer.disconnect()
        void api(`/creator/posts/${post.id}/view`, { method: 'POST' }).catch(() => {})
      }, 1000)
      else clearTimeout(timer)
    }, { threshold: 0.5 })
    observer.observe(card.current)
    return () => { clearTimeout(timer); observer.disconnect() }
  }, [post.id, post.author_id, viewerId])
  const [manageCollaboration, setManageCollaboration] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareNotice, setShareNotice] = useState('')
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: () => api<Conversation[]>('/conversations'), enabled: shareOpen })
  const refresh = () => { for (const key of ['feed', 'post', 'bookmarks', 'profile-posts', 'community-posts', 'topic']) void client.invalidateQueries({ queryKey: [key] }) }
  const react = useMutation({ mutationFn: () => api<Post>(`/social/posts/${post.id}/reaction`, { method: post.my_reaction ? 'DELETE' : 'POST', ...(!post.my_reaction ? { body: { emoji: '❤️' } } : {}) }), onSuccess: refresh })
  const bookmark = useMutation({ mutationFn: () => api<Post>(`/social/posts/${post.id}/bookmark`, { method: post.bookmarked ? 'DELETE' : 'POST' }), onSuccess: refresh })
  const vote = useMutation({ mutationFn: (option_id: number) => api<Post>(`/social/posts/${post.id}/vote`, { method: 'POST', body: { option_id } }), onSuccess: refresh })
  const follow = useMutation({ mutationFn: () => api(`/social/profiles/${post.author_id}/follow?source_kind=POST&source_id=${post.id}`, { method: 'POST' }), onSuccess: refresh })
  const shareChat = useMutation({ mutationFn: (conversationId: number) => api(`/social/posts/${post.id}/share-to-chat`, { method: 'POST', body: { conversation_id: conversationId } }), onSuccess: () => { setShareOpen(false); setShareNotice('Post sent to chat'); void client.invalidateQueries({ queryKey: ['conversations'] }) }, onError: (cause: Error) => setShareNotice(cause.message) })
  const copyLink = async () => { try { await navigator.clipboard.writeText(`${location.origin}/app/posts/${post.public_id || post.id}`); setShareOpen(false); setShareNotice('Post link copied') } catch { setShareNotice('Could not copy the link. Please try again.') } }
  return <article className="post-card" ref={card}>
    <div className="post-header"><Link to={`/profile/${post.author_id}`}><Avatar user={post.author} /></Link><div className="post-identity"><div className="post-authors"><Link to={`/profile/${post.author_id}`}><strong>{post.author.display_name || post.author.username}</strong></Link>{post.collaborators?.map(user => <Link key={user.id} to={`/profile/${user.id}`}>+ @{user.username}</Link>)}</div><small>@{post.author.username} · {timeAgo(post.created_at)}</small></div>{!!post.collaborators?.length && <div className="post-collaborator-avatars" aria-label="Collaborators">{post.collaborators.slice(0, 3).map(user => <Link key={user.id} to={`/profile/${user.id}`} title={`@${user.username}`}><Avatar user={user} /></Link>)}</div>}{(viewerId === post.author_id || post.collaborators?.some(user => user.id === viewerId)) && <button className="post-collab-button" onClick={() => setManageCollaboration(true)} aria-label="Manage collaborators"><Users size={18} /></button>}<Link className="post-more" to={`/posts/${post.public_id || post.id}`} aria-label="More post options"><MoreHorizontal size={20} /></Link></div>
    {viewerId !== post.author_id && !post.author.is_private && !post.author.is_following && <button className="post-follow" disabled={follow.isPending} onClick={() => follow.mutate()}>{follow.isPending ? 'Following…' : 'Follow author'}</button>}
    {post.content && <p className="post-copy">{post.content}</p>}
    {post.media_url && (post.media_type === 'VIDEO' ? <video className="post-image" src={mediaUrl(post.media_url)} controls playsInline preload="none" /> : <img className="post-image" src={imagePreviewUrl(post.media_url, 960)} alt={`Post by ${post.author.display_name || post.author.username}`} loading="lazy" decoding="async" />)}
    {post.original && <div className="post-original"><strong>{post.original.author.display_name || post.original.author.username}</strong><p>{post.original.content}</p></div>}
    {!!post.poll?.length && <div className="post-poll">{post.poll.map(option => <button key={option.id} disabled={!!post.my_vote || vote.isPending} className={post.my_vote === option.id ? 'voted' : ''} onClick={() => vote.mutate(option.id)}>{option.label}{option.votes != null && <span>{option.votes} votes</span>}</button>)}</div>}
    <div className="post-actions"><Link to={`/posts/${post.public_id || post.id}`} aria-label={`Comments: ${post.comments_count}`}><MessageCircle size={20} /><span>{post.comments_count}</span></Link><button disabled={react.isPending} className={post.my_reaction ? 'engaged' : ''} onClick={() => react.mutate()} aria-label={post.my_reaction ? 'Unlike post' : 'Like post'}><Heart size={20} fill={post.my_reaction ? 'currentColor' : 'none'} /><span>{post.likes_count}</span></button><button onClick={() => { void api(`/social/posts/${post.id}/repost`, { method: 'POST', body: {} }).then(() => client.invalidateQueries({ queryKey: ['feed'] })).catch((cause: Error) => alert(cause.message)) }} aria-label={`Repost: ${post.reposts_count}`}><Repeat2 size={20} /><span>{post.reposts_count}</span></button><button disabled={bookmark.isPending} onClick={() => bookmark.mutate()} aria-label={post.bookmarked ? 'Remove bookmark' : 'Bookmark'}><Bookmark size={20} fill={post.bookmarked ? 'currentColor' : 'none'} /></button><button onClick={() => { setShareNotice(''); setShareOpen(true) }} aria-label="Share"><Send size={20} /></button></div>
    {(viewerId === post.author_id && !post.author.is_private || post.collaborators?.some(user => user.id === viewerId)) && <Link className="content-insights-link" to={`/professional-dashboard/insights/POST/${post.id}`}>View insights</Link>}
    {shareNotice && !shareOpen && <div className="post-share-feedback" role="status">{shareNotice}<button onClick={() => setShareNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {shareOpen && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShareOpen(false) }}><div className="dialog-card reel-share-dialog" role="dialog" aria-modal="true" aria-labelledby={`post-share-title-${post.id}`}><header><div><h2 id={`post-share-title-${post.id}`}>Share this post</h2><p>Send it to a chat or copy its link.</p></div><button className="icon-button" onClick={() => setShareOpen(false)} aria-label="Close share dialog"><X /></button></header><div className="reel-share-body"><button className="reel-copy-link" onClick={() => void copyLink()}><Copy size={19} /> Copy link</button><h3>Send in chat</h3>{conversations.isPending && <p className="muted">Loading chats…</p>}{conversations.error && <ErrorBox error={conversations.error} retry={() => void conversations.refetch()} />}{conversations.data && (conversations.data.filter(conv => !conv.is_locked || conv.is_unlocked).length ? <div className="reel-share-chats">{conversations.data.filter(conv => !conv.is_locked || conv.is_unlocked).map(conv => <button key={conv.id} disabled={shareChat.isPending} onClick={() => shareChat.mutate(conv.id)}><Avatar user={conv.other_user || { id: conv.id, username: conv.name || 'Group' }} size="sm" /><span><strong>{conv.name || conv.other_user?.display_name || conv.other_user?.username || 'Conversation'}</strong><small>{conv.type === 'GROUP' ? 'Group chat' : 'Direct message'}</small></span><Send size={17} /></button>)}</div> : <p className="muted">No available chats. Start a chat to share this post.</p>)}{shareNotice && <p className="form-error" role="alert">{shareNotice}</p>}</div></div></div>}
    {manageCollaboration && <CollaborationManager post={post} close={() => setManageCollaboration(false)} />}
  </article>
}

export function FeedPage() {
  const user = useAuth(state => state.user)
  const [mode, setMode] = useState<'for_you' | 'following'>('for_you')
  const [compose, setCompose] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [editing, setEditing] = useState<QueuedPost | null>(null)
  const feed = useInfiniteQuery({ queryKey: ['feed', mode], initialPageParam: 0, queryFn: ({ pageParam }) => api<Page<Post>>(query('/social/feed', { mode, limit: 20, offset: pageParam })), getNextPageParam: page => page.next_offset ?? undefined })
  const reels = useQuery({ queryKey: ['reels', 'for_you'], queryFn: () => api<Page<Reel>>(query('/reels', { mode: 'for_you', limit: 4 })) })
  return <Shell active="Home" onCreate={() => setCompose(true)} aside={<><div className="aside-search"><Search size={19} /> Find people and topics</div><section className="aside-card"><h2>Explore</h2><p>Find people, posts, and topics across Relaydot.</p><Link className="button primary" to="/explore">Open explore</Link></section><section className="aside-card"><h2>Your lists</h2><Link to="/communities">Communities →</Link><Link to="/bookmarks">Saved posts →</Link></section></>}>
    <header className="page-header"><h1>Home</h1><Link to="/notifications" className="header-icon" aria-label="Activity"><Heart size={22} /></Link></header>
    <div className="feed-tabs" role="tablist" aria-label="Feed"><button role="tab" aria-selected={mode === 'for_you'} className={mode === 'for_you' ? 'selected' : ''} onClick={() => setMode('for_you')}>For you</button><button role="tab" aria-selected={mode === 'following'} className={mode === 'following' ? 'selected' : ''} onClick={() => setMode('following')}>Following</button></div>
    <StoriesStrip />
    <OfflineQueueButton onOpen={() => setQueueOpen(true)} />
    <button className="inline-compose" onClick={() => setCompose(true)}><Avatar user={user} /><span>What's on your mind?</span><ImagePlus size={20} /></button>
    {feed.isPending && <div className="loading-list">Loading your feed…</div>}{feed.error && <ErrorBox error={feed.error} retry={() => void feed.refetch()} />}{feed.data && (feed.data.pages.flatMap(page => page.items).length ? feed.data.pages.flatMap(page => page.items).map(post => <PostCard key={post.id} post={post} />) : <Empty title="No posts yet" action={<Link className="button secondary" to="/explore">Find people to follow</Link>}>Follow someone or publish a post to start your feed.</Empty>)}
    {feed.hasNextPage && <button className="load-link" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>{feed.isFetchingNextPage ? 'Loading…' : 'View more posts'}</button>}
    {!!reels.data?.items.length && <section className="feed-reels"><div className="section-heading"><h2>Reels to watch</h2><Link to="/reels">See all</Link></div><div className="reel-preview-strip">{reels.data.items.map(reel => <Link key={reel.public_id} to={`/reels?id=${reel.public_id}`}><img src={mediaUrl(reel.thumbnail_url)} alt={reel.caption || 'Reel'} loading="lazy" decoding="async" /><span>@{reel.creator.username}</span></Link>)}</div></section>}
    {queueOpen && <OfflineQueuePanel close={() => setQueueOpen(false)} edit={post => { setQueueOpen(false); setEditing(post); setCompose(true) }} />}
    {compose && <PostComposer initial={editing} close={() => { setCompose(false); setEditing(null) }} />}
  </Shell>
}
