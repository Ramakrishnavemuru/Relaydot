import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck, Heart, MessageCircle, UserPlus, Video } from 'lucide-react'
import { api, mediaUrl, query } from '../api'
import { Avatar, Empty, ErrorBox, Shell, timeAgo } from '../components'
import type { Notification, Page, Post, User } from '../types'

type ActivityPage = Page<Notification> & { unread: number }

function activityLabel(type: string) {
  const labels: Record<string, string> = {
    security_login: '— sign-in from an unfamiliar browser', security_password: '— password changed',
    security_mfa_enabled: '— authenticator enabled', security_mfa_disabled: '— authenticator disabled',
    security_recovery: '— recovery codes replaced',
    message: 'messaged you', follow: 'started following you', reel_like: 'liked your Reel',
    reel_comment: 'commented on your Reel', reel_reply: 'replied to your Reel comment',
    reel_mention: 'tagged you in a Reel', reel_share: 'shared your Reel',
    like: 'liked your post', comment: 'commented on your post',
    thread_reply: 'replied to your message', mention: 'mentioned you in a post',
    repost: 'reposted your post', quote: 'quoted your post',
    collaboration_invite: 'invited you to collaborate on a post',
  }
  return labels[type] || type.replaceAll('_', ' ')
}

function activityDestination(item: Notification) {
  if (item.entity_type === 'security') return '/settings?section=security'
  if (item.entity_type === 'conversation') return item.conversation_public_id ? `/chats?chat=${item.conversation_public_id}` : '/chats'
  if (item.entity_type === 'user') return `/profile/${item.actor?.id || item.entity_id}`
  if (item.entity_type === 'reel') return item.reel_public_id ? `/reels?id=${item.reel_public_id}` : '/reels'
  if (item.entity_type === 'community') return `/communities/${item.entity_id}`
  if (item.entity_type === 'post') return `/posts/${item.post_public_id || item.entity_id}`
  return '/'
}

function ActivityIcon({ type }: { type: string }) {
  if (type === 'message' || type === 'thread_reply') return <MessageCircle size={14} />
  if (type === 'follow') return <UserPlus size={14} />
  if (type.startsWith('reel_') && type !== 'reel_like') return <Video size={14} />
  if (type.includes('like')) return <Heart size={14} />
  return <Bell size={14} />
}

export function NotificationsPage() {
  const client = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [review, setReview] = useState<{ post: Post; invitation: { post_id: number } } | null>(null)
  const [reviewError, setReviewError] = useState('')
  const invitations = useQuery({ queryKey: ['collaboration-invitations'], queryFn: () => api<{ items: { post_id: number; creator: User; post_preview: string }[] }>('/social/collaborations/invitations') })
  const respond = useMutation({ mutationFn: ({ postId, accept }: { postId: number; accept: boolean }) => api(`/social/posts/${postId}/collaborators/respond?accept=${accept}`, { method: 'POST' }),
    onSuccess: () => { setReview(null); void client.invalidateQueries({ queryKey: ['collaboration-invitations'] }); void client.invalidateQueries({ queryKey: ['notifications'] }); void client.invalidateQueries({ queryKey: ['profile-posts'] }); void client.invalidateQueries({ queryKey: ['feed'] }) },
    onError: cause => setReviewError(cause.message),
  })
  const openReview = async (postId: number) => { setReviewError(''); try { setReview(await api<{ post: Post; invitation: { post_id: number } }>(`/social/collaborations/invitations/${postId}`)) } catch (cause) { setReviewError(cause instanceof Error ? cause.message : 'Invitation unavailable') } }
  const notifications = useInfiniteQuery({ queryKey: ['notifications'], initialPageParam: 0,
    queryFn: ({ pageParam }) => api<ActivityPage>(query('/social/notifications', { limit: 50, offset: pageParam })),
    getNextPageParam: last => last.next_offset ?? undefined,
  })
  const changeCache = (ids: number[] | null) => {
    client.setQueryData<InfiniteData<ActivityPage>>(['notifications'], old => {
      if (!old) return old
      const changed = old.pages.flatMap(page => page.items).filter(item => !item.read && (!ids || ids.includes(item.id))).length
      return { ...old, pages: old.pages.map(page => ({ ...page, unread: ids ? Math.max(0, page.unread - changed) : 0,
        items: page.items.map(item => !ids || ids.includes(item.id) ? { ...item, read: true } : item) })) }
    })
  }
  const markRead = useMutation({ mutationFn: (ids: number[] | null) => api('/social/notifications/read', { method: 'POST', body: { ids } }),
    onMutate: async ids => { await client.cancelQueries({ queryKey: ['notifications'] }); const previous = client.getQueryData<InfiniteData<ActivityPage>>(['notifications']); changeCache(ids); return { previous } },
    onError: (_error, _ids, context) => { if (context?.previous) client.setQueryData(['notifications'], context.previous) },
    onSettled: () => void client.invalidateQueries({ queryKey: ['notifications'] }) })
  const pages = notifications.data?.pages || []
  const items = pages.flatMap(page => page.items)
  const unread = pages[0]?.unread || 0
  const visible = filter === 'unread' ? items.filter(item => !item.read) : items
  return <Shell active="Activity"><header className="page-header"><h1>Activity</h1><Bell size={21} /></header>
    <div className="activity-intro"><div><span className="activity-eyebrow">YOUR UPDATES</span><h2>What’s happening</h2><p>Messages and moments from your community.</p></div><span className="activity-unread-count">{unread} unread</span></div>
    <div className="activity-toolbar"><div role="tablist" aria-label="Activity filter"><button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button><button role="tab" aria-selected={filter === 'unread'} className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>Unread {unread > 0 && <span>{unread}</span>}</button></div>{unread > 0 && <button className="activity-mark-all" disabled={markRead.isPending} onClick={() => markRead.mutate(null)}><CheckCheck size={16} /> Mark all read</button>}</div>
    {!!invitations.data?.items.length && <section className="collaboration-invitations"><h2>Pending invitations <span>{invitations.data.items.length}</span></h2>{invitations.data.items.map(item => <div key={item.post_id} className="collaboration-invitation"><Avatar user={item.creator} /><div><strong>@{item.creator.username} invited you to collaborate</strong><p>{item.post_preview || 'Media post'}</p></div><button className="button" onClick={() => void openReview(item.post_id)}>Review</button></div>)}</section>}
    {reviewError && <p className="form-error" role="alert">{reviewError}</p>}
    {notifications.isPending && <div className="loading-list">Loading activity…</div>}{notifications.error && <ErrorBox error={notifications.error} retry={() => void notifications.refetch()} />}
    {!!pages.length && (visible.length ? <div className="activity-list">{visible.map(item => item.type === 'collaboration_invite' ? <div className={`activity-item ${item.read ? '' : 'unread'}`} key={item.id}><span className="activity-avatar"><Avatar user={item.actor} /></span><span className="activity-item-copy"><span><strong>{item.actor?.display_name || item.actor?.username || 'Someone'}</strong> {activityLabel(item.type)}</span><small>{item.post_preview || 'Media post'} · {timeAgo(item.created_at)}</small></span>{item.invitation_status === 'PENDING' && <button className="button" onClick={() => { void openReview(item.entity_id); if (!item.read) markRead.mutate([item.id]) }}>Review</button>}</div> : <Link className={`activity-item ${item.read ? '' : 'unread'}`} key={item.id} to={activityDestination(item)} onClick={() => { if (!item.read) markRead.mutate([item.id]) }}><span className="activity-avatar"><Avatar user={item.actor} /><span className={`activity-kind ${item.type}`}><ActivityIcon type={item.type} /></span></span><span className="activity-item-copy"><span><strong>{item.actor?.display_name || item.actor?.username || 'Someone'}</strong> {activityLabel(item.type)}</span><small>{timeAgo(item.created_at)}</small></span>{!item.read && <i aria-label="Unread" />}</Link>)}</div> : <Empty title={filter === 'unread' ? 'No unread activity' : 'All caught up'} icon={<Bell size={35} />}>{filter === 'unread' ? 'You’re up to date.' : 'New messages, follows, and Reel activity will appear here.'}</Empty>)}
    {notifications.hasNextPage && <button className="load-link activity-more" disabled={notifications.isFetchingNextPage} onClick={() => void notifications.fetchNextPage()}>{notifications.isFetchingNextPage ? 'Loading…' : 'Show more activity'}</button>}
    {review && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setReview(null) }}><div className="dialog-card invitation-review" role="dialog" aria-modal="true" aria-labelledby="invitation-review-title"><header><h2 id="invitation-review-title">Collaboration invitation</h2><button className="icon-button" onClick={() => setReview(null)} aria-label="Close">×</button></header><div className="invitation-review-body"><div className="post-header"><Avatar user={review.post.author} /><div><strong>{review.post.author.display_name || review.post.author.username}</strong><small>@{review.post.author.username}</small></div></div><p>{review.post.content}</p>{review.post.media_url && (review.post.media_type === 'VIDEO' ? <video controls src={mediaUrl(review.post.media_url)} /> : <img src={mediaUrl(review.post.media_url)} alt="Post preview" />)}<p>Accepting adds this single shared post to your profile. The original creator controls its content.</p></div><div className="dialog-actions"><button className="button" disabled={respond.isPending} onClick={() => respond.mutate({ postId: review.post.id, accept: false })}>Decline</button><button className="button primary" disabled={respond.isPending} onClick={() => respond.mutate({ postId: review.post.id, accept: true })}>Accept</button></div></div></div>}
  </Shell>
}
