import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Bookmark, ChevronDown, ChevronUp, Heart, MessageCircle, Pause, Play, Plus, Send, Volume2, VolumeX, X } from 'lucide-react'
import { api, mediaUrl, query } from '../api'
import { Avatar, Empty, ErrorBox, Shell } from '../components'
import type { Page, Reel } from '../types'
import { useAuth } from '../store'

type ReelComment = { id: number; content: string; author?: { username: string; display_name?: string; avatar_url?: string; id: number }; created_at: string }

export function ReelsPage() {
  const me = useAuth(state => state.user)
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<'for_you' | 'following' | 'trending' | 'new' | 'saved' | 'mine'>('for_you')
  const [index, setIndex] = useState(0)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [showComments, setShowComments] = useState(false)
  const [comment, setComment] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [video, setVideo] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [editCaption, setEditCaption] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const positioning = useRef(false)
  const wheelLockedUntil = useRef(0)
  const positionedFor = useRef('')
  const watchSession = useRef(crypto.randomUUID())
  const viewReported = useRef(false)
  const list = useQuery({ queryKey: ['reels', mode], queryFn: () => api<Page<Reel>>(query('/reels', { mode, limit: 20 })) })
  const targetId = params.get('id')
  const selectedIndex = targetId ? list.data?.items.findIndex(item => item.public_id === targetId) ?? -1 : -1
  const activeIndex = selectedIndex >= 0 ? selectedIndex : index
  const reel = list.data?.items[activeIndex]
  const comments = useQuery({ queryKey: ['reel-comments', reel?.public_id], queryFn: () => api<Page<ReelComment>>(query(`/reels/${reel!.public_id}/comments`, { limit: 30 })), enabled: showComments && !!reel })
  const toggleLike = useMutation({ mutationFn: () => api(`/reels/${reel!.public_id}/like`, { method: reel?.liked ? 'DELETE' : 'POST' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['reels', mode] }) })
  const toggleBookmark = useMutation({ mutationFn: () => api(`/reels/${reel!.public_id}/bookmark`, { method: reel?.bookmarked ? 'DELETE' : 'POST' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['reels', mode] }) })
  const addComment = useMutation({ mutationFn: () => api(`/reels/${reel!.public_id}/comments`, { method: 'POST', body: { content: comment } }), onSuccess: () => { setComment(''); void client.invalidateQueries({ queryKey: ['reel-comments', reel?.public_id] }); void client.invalidateQueries({ queryKey: ['reels', mode] }) } })
  const create = useMutation({ mutationFn: () => { const form = new FormData(); form.append('video', video!); form.append('caption', caption); return api<Reel>('/reels', { method: 'POST', body: form }) }, onSuccess: () => { setCreateOpen(false); setVideo(null); setCaption(''); setMode('new'); void client.invalidateQueries({ queryKey: ['reels'] }) }, onError: (cause: Error) => setUploadError(cause.message) })
  const edit = useMutation({ mutationFn: (body: object) => api<Reel>(`/reels/${reel!.public_id}`, { method: 'PATCH', body }), onSuccess: () => { setManageOpen(false); void client.invalidateQueries({ queryKey: ['reels'] }) }, onError: (cause: Error) => setUploadError(cause.message) })
  const remove = useMutation({ mutationFn: () => api(`/reels/${reel!.public_id}`, { method: 'DELETE' }), onSuccess: () => { setManageOpen(false); setIndex(0); setParams({}); void client.invalidateQueries({ queryKey: ['reels'] }) }, onError: (cause: Error) => setUploadError(cause.message) })
  const move = (delta: number) => {
    const next = activeIndex + delta
    if (next < 0 || next >= (list.data?.items.length || 0)) return
    feedRef.current?.scrollTo({ top: next * feedRef.current.clientHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  useEffect(() => {
    if (!list.data?.items.length || !feedRef.current) return
    const key = mode
    if (positionedFor.current === key) return
    positionedFor.current = key
    const target = targetId ? list.data.items.findIndex(item => item.public_id === targetId) : 0
    positioning.current = true
    feedRef.current.scrollTop = Math.max(0, target) * feedRef.current.clientHeight
    requestAnimationFrame(() => { positioning.current = false })
  }, [list.data, mode, targetId])
  useEffect(() => {
    watchSession.current = crypto.randomUUID()
    viewReported.current = false
    feedRef.current?.querySelectorAll('video').forEach(video => { if (video !== videoRef.current) video.pause() })
    if (videoRef.current) videoRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }, [reel?.public_id])
  useEffect(() => {
    const feed = feedRef.current
    if (!feed) return
    const onWheel = (event: WheelEvent) => {
      if (showComments || manageOpen || createOpen || Math.abs(event.deltaY) < 10) return
      event.preventDefault()
      if (Date.now() < wheelLockedUntil.current) return
      wheelLockedUntil.current = Date.now() + 520
      move(event.deltaY > 0 ? 1 : -1)
    }
    feed.addEventListener('wheel', onWheel, { passive: false })
    return () => feed.removeEventListener('wheel', onWheel)
  })
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return; if (event.key === 'ArrowDown') move(1); if (event.key === 'ArrowUp') move(-1) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) })
  const togglePlay = () => { if (!videoRef.current) return; if (videoRef.current.paused) { void videoRef.current.play(); setPlaying(true) } else { videoRef.current.pause(); setPlaying(false) } }
  const onFeedScroll = () => {
    const feed = feedRef.current
    if (!feed || positioning.current || !list.data?.items.length) return
    const next = Math.min(list.data.items.length - 1, Math.max(0, Math.round(feed.scrollTop / feed.clientHeight)))
    if (next === activeIndex) return
    setIndex(next)
    setParams({ id: list.data.items[next].public_id }, { replace: true })
    setShowComments(false)
  }
  const trackView = () => { if (!reel || viewReported.current || (videoRef.current?.currentTime || 0) < 3) return; viewReported.current = true; void api(`/reels/${reel.public_id}/view`, { method: 'POST', body: { session_id: watchSession.current.replaceAll('-', ''), watched_ms: Math.min(180000, Math.round(videoRef.current!.currentTime * 1000)), completed: false } }).catch(() => { viewReported.current = false }) }
  const share = async () => { if (!reel) return; const url = `${location.origin}/app/reels?id=${reel.public_id}`; try { await navigator.share({ url }) } catch { await navigator.clipboard?.writeText(url) } }
  return <Shell active="Reels"><header className="page-header"><h1>Reels</h1><button className="header-icon" onClick={() => setCreateOpen(true)} title="Create Reel" aria-label="Create Reel"><Plus size={23} /></button></header><div className="reel-mode-tabs">{(['for_you', 'following', 'trending', 'new', 'saved', 'mine'] as const).map(value => <button key={value} className={mode === value ? 'active' : ''} onClick={() => { setMode(value); setIndex(0); setParams({}) }}>{value === 'for_you' ? 'For you' : value === 'mine' ? 'My Reels' : value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    {list.isPending && <div className="loading-list">Finding Reels…</div>}
    {list.error && <ErrorBox error={list.error} retry={() => void list.refetch()} />}
    {list.data && (list.data.items.length ? <div className="reels-feed" ref={feedRef} onScroll={onFeedScroll} aria-label="Reels feed">
      {list.data.items.map((item, slideIndex) => {
        const isActive = slideIndex === activeIndex
        return <div className="reels-stage" key={item.public_id} data-reel-id={item.public_id}>
          <div className="reels-frame">
            <video ref={isActive ? videoRef : undefined} src={Math.abs(slideIndex - activeIndex) <= 1 ? mediaUrl(item.video_url) : undefined} poster={mediaUrl(item.thumbnail_url)} preload={Math.abs(slideIndex - activeIndex) <= 1 ? 'metadata' : 'none'} playsInline loop autoPlay={isActive} muted={muted || !isActive} onClick={isActive ? togglePlay : () => move(slideIndex - activeIndex)} onTimeUpdate={isActive ? trackView : undefined} aria-label={`Reel by ${item.creator.username}`} />
            <div className="reel-shade" />
            <div className="reel-top"><span>REEL</span>{isActive && <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX size={22} /> : <Volume2 size={22} />}</button>}</div>
            {isActive && <button className={`reel-play ${playing ? '' : 'paused'}`} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={25} /> : <Play size={25} />}</button>}
            <div className="reel-caption"><Link to={`/profile/${item.creator_id}`}><Avatar user={item.creator} size="sm" /><strong>@{item.creator.username}</strong></Link><p>{item.caption}</p></div>
          </div>
          {isActive && <div className="reel-side-actions">{item.creator_id === me?.id && <button onClick={() => { setEditCaption(item.caption); setManageOpen(true); setUploadError('') }} aria-label="Manage Reel">Manage</button>}<button disabled={toggleLike.isPending} onClick={() => toggleLike.mutate()} aria-label={item.liked ? 'Unlike Reel' : 'Like Reel'}><Heart fill={item.liked ? 'currentColor' : 'none'} /><span>{item.likes_count}</span></button><button onClick={() => setShowComments(true)} aria-label="Comments"><MessageCircle /><span>{item.comments_count}</span></button><button onClick={() => void share()} aria-label="Share Reel"><Send /><span>Share</span></button><button disabled={toggleBookmark.isPending} onClick={() => toggleBookmark.mutate()} aria-label={item.bookmarked ? 'Unsave Reel' : 'Save Reel'}><Bookmark fill={item.bookmarked ? 'currentColor' : 'none'} /><span>Save</span></button></div>}
          {isActive && <div className="reel-step"><button disabled={activeIndex === 0} onClick={() => move(-1)} aria-label="Previous Reel"><ChevronUp /></button><button disabled={activeIndex === list.data.items.length - 1} onClick={() => move(1)} aria-label="Next Reel"><ChevronDown /></button></div>}
        </div>
      })}
    </div> : <Empty title="No Reels yet">There are no videos in this view. <button className="text-button" onClick={() => setCreateOpen(true)}>Create a Reel</button> to get started.</Empty>)}
    {createOpen && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreateOpen(false) }}><div className="dialog-card" role="dialog" aria-modal="true"><header><h2>Create Reel</h2><button className="icon-button" onClick={() => setCreateOpen(false)}><X /></button></header><form className="profile-edit-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (video) create.mutate() }}><label>Video (MP4 or WebM, up to 60 MB)<input type="file" accept="video/mp4,video/webm" required onChange={event => setVideo(event.target.files?.[0] || null)} /></label><label>Caption<textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} /></label>{uploadError && <p className="form-error">{uploadError}</p>}<button className="button primary" disabled={!video || create.isPending}>{create.isPending ? 'Uploading…' : 'Publish Reel'}</button></form></div></div>}
    {manageOpen && reel && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setManageOpen(false) }}><div className="dialog-card" role="dialog" aria-modal="true"><header><h2>Manage Reel</h2><button className="icon-button" onClick={() => setManageOpen(false)}><X /></button></header><form className="profile-edit-form" onSubmit={(event: FormEvent) => { event.preventDefault(); edit.mutate({ caption: editCaption }) }}><label>Caption<textarea value={editCaption} onChange={event => setEditCaption(event.target.value)} maxLength={2200} /></label>{uploadError && <p className="form-error">{uploadError}</p>}<div className="reel-manage-actions"><button className="button primary" disabled={edit.isPending}>Save</button><button type="button" className="button secondary" onClick={() => edit.mutate({ archive: reel.status !== 'ARCHIVED' })}>{reel.status === 'ARCHIVED' ? 'Unarchive' : 'Archive'}</button><button type="button" className="button secondary" onClick={() => { if (confirm('Delete this Reel?')) remove.mutate() }}>Delete</button></div></form></div></div>}
    {showComments && reel && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowComments(false) }}><div className="dialog-card comments-card" role="dialog" aria-modal="true" aria-labelledby="comments-title"><header><h2 id="comments-title">Comments</h2><button className="icon-button" onClick={() => setShowComments(false)} aria-label="Close"><X size={21} /></button></header><div className="comments-list">{comments.isPending && <p className="muted">Loading comments…</p>}{comments.error && <ErrorBox error={comments.error} />}{comments.data?.items.map(item => <div className="comment-row" key={item.id}><Avatar user={item.author} size="sm" /><p><strong>{item.author?.display_name || item.author?.username}</strong><br />{item.content}</p></div>)}{comments.data?.items.length === 0 && <p className="muted">Be the first to comment.</p>}</div><form className="comment-form" onSubmit={event => { event.preventDefault(); if (comment.trim()) addComment.mutate() }}><input value={comment} onChange={event => setComment(event.target.value)} placeholder="Write a comment" aria-label="Write a comment" /><button disabled={!comment.trim() || addComment.isPending} aria-label="Post comment"><Send size={20} /></button></form></div></div>}
  </Shell>
}
