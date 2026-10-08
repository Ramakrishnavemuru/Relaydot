import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { api, query } from '../api'
import { Avatar, Empty, ErrorBox, Shell, timeAgo } from '../components'
import type { Notification, Page } from '../types'

export function NotificationsPage() {
  const client = useQueryClient()
  const [offset, setOffset] = useState(0)
  const notifications = useQuery({ queryKey: ['notifications', offset], queryFn: () => api<Page<Notification> & { unread: number }>(query('/social/notifications', { limit: 50, offset })) })
  const markRead = useMutation({ mutationFn: () => api('/social/notifications/read', { method: 'POST', body: { ids: null } }), onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }) })
  return <Shell active="Activity"><header className="page-header"><h1>Activity</h1><Bell size={21} /></header><div className="activity-controls"><span>{notifications.data?.unread || 0} unread</span>{!!notifications.data?.unread && <button onClick={() => markRead.mutate()} disabled={markRead.isPending}>Mark all as read</button>}</div>{notifications.isPending && <div className="loading-list">Loading activity…</div>}{notifications.error && <ErrorBox error={notifications.error} retry={() => void notifications.refetch()} />}{notifications.data && (notifications.data.items.length ? notifications.data.items.map(item => <Link className={`notification-row ${item.read ? '' : 'unread'}`} key={item.id} to={item.entity_type === 'user' ? `/profile/${item.actor?.id}` : item.entity_type === 'reel' ? '/reels' : item.entity_type === 'community' ? `/communities/${item.entity_id}` : item.entity_type === 'post' ? `/posts/${item.entity_id}` : '/'}><Avatar user={item.actor} /><span><strong>{item.actor?.display_name || item.actor?.username || 'Someone'}</strong> {item.type.replaceAll('_', ' ')}<small>{timeAgo(item.created_at)}</small></span></Link>) : <Empty title="All caught up">New activity will show here.</Empty>)}{notifications.data?.next_offset != null && <button className="load-link" onClick={() => setOffset(notifications.data!.next_offset!)}>More activity</button>}</Shell>
}
