import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { BarChart3, Bookmark, CalendarClock, Check, ChevronDown, ChevronUp, Copy, Download, Heart, MapPin, MessageCircle, MoreHorizontal, Pause, Play, PlaySquare, Plus, Send, Volume2, VolumeX, X } from 'lucide-react'
import { api, mediaUrl, query } from '../api'
import { Avatar, Empty, ErrorBox, Shell, timeAgo } from '../components'
import type { Conversation, Page, Reel, User } from '../types'
import { useAuth } from '../store'
import { useReelPlayback } from '../reelPlayback'
import { ReelManageSheet } from '../ReelManageSheet'

type ReelComment = { id: number; content: string; author?: { username: string; display_name?: string; avatar_url?: string; id: number }; created_at: string; parent_id?: number | null; likes_count: number; liked: boolean; pinned: boolean }

export function ReelsPage() {
  const me = useAuth(state => state.user)
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<'for_you' | 'following' | 'trending' | 'new' | 'saved' | 'mine' | 'archive'>('for_you')
  const [index, setIndex] = useState(0)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [showComments, setShowComments] = useState(false)
  const [comment, setComment] = useState('')
  const [commentError, setCommentError] = useState('')
  const [replyToComment, setReplyToComment] = useState<ReelComment | null>(null)
  const [deleteCommentTarget, setDeleteCommentTarget] = useState<ReelComment | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [video, setVideo] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [locationName, setLocationName] = useState('')
  const [tags, setTags] = useState('')
  const [tagSearch, setTagSearch] = useState('')
  const [taggedPeople, setTaggedPeople] = useState<User[]>([])
  const [audience, setAudience] = useState<'EVERYONE' | 'FOLLOWERS' | 'FRIENDS' | 'ONLY_ME'>('EVERYONE')
  const [scheduledAt, setScheduledAt] = useState('')
  const [hideLikeCount, setHideLikeCount] = useState(false)
  const [hideShareCount, setHideShareCount] = useState(false)
  const [allowDownload, setAllowDownload] = useState(false)
  const [pollEnabled, setPollEnabled] = useState(false)
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [videoPreview, setVideoPreview] = useState('')
  const [videoDuration, setVideoDuration] = useState(0)
  const [uploadError, setUploadError] = useState('')
  const [reactionError, setReactionError] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareReelId, setShareReelId] = useState('')
  const [shareNotice, setShareNotice] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const positioning = useRef(false)
  const wheelLockedUntil = useRef(0)
  const scrollCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const positionedFor = useRef('')
  const list = useQuery({
    queryKey: ['reels', me?.id, mode],
    queryFn: () => api<Page<Reel>>(query('/reels', { mode, limit: 20 })),
    enabled: !!me,
    refetchInterval: mode === 'mine' ? 5000 : ['for_you', 'following', 'new'].includes(mode) ? 15000 : false,
  })
  const targetId = params.get('id')
  const targetInFeed = targetId ? list.data?.items.some(item => item.public_id === targetId) : false
  const directReel = useQuery({ queryKey: ['reel', targetId], queryFn: () => api<Reel>(`/reels/${targetId}`), enabled: !!me && !!targetId && !targetInFeed })
  const items = targetId && !targetInFeed ? directReel.data ? [directReel.data] : [] : list.data?.items || []
  const selectedIndex = targetId ? items.findIndex(item => item.public_id === targetId) : -1
  const activeIndex = selectedIndex >= 0 ? selectedIndex : index
  const reel = items[activeIndex]
  const playback = useReelPlayback(reel?.public_id, videoRef)
  const reelKey = ['reels', me?.id, mode] as const
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: () => api<Conversation[]>('/conversations'), enabled: shareOpen })
  const suggestions = useQuery({ queryKey: ['reel-tag-people', tagSearch], queryFn: () => api<User[]>(query('/social/mentions/suggestions', { q: tagSearch.trim() })), enabled: createOpen && tagSearch.trim().length > 0 })
  const comments = useQuery({ queryKey: ['reel-comments', reel?.public_id], queryFn: () => api<Page<ReelComment>>(query(`/reels/${reel!.public_id}/comments`, { limit: 30 })), enabled: showComments && !!reel })
  const toggleLike = useMutation({ mutationFn: ({ id, liked }: { id: string; liked: boolean }) => api<Reel>(`/reels/${id}/like`, { method: liked ? 'DELETE' : 'POST' }), onMutate: async ({ id, liked }) => {
    await client.cancelQueries({ queryKey: reelKey })
    const previous = client.getQueryData<Page<Reel>>(reelKey)
    const previousDirect = client.getQueryData<Reel>(['reel', id])
    client.setQueryData<Page<Reel>>(reelKey, old => old && ({ ...old, items: old.items.map(item => item.public_id === id ? { ...item, liked: !liked, likes_count: item.likes_count == null ? null : Math.max(0, item.likes_count + (liked ? -1 : 1)) } : item) }))
    client.setQueryData<Reel>(['reel', id], old => old && ({ ...old, liked: !liked, likes_count: old.likes_count == null ? null : Math.max(0, old.likes_count + (liked ? -1 : 1)) }))
    setReactionError('')
    return { previous, previousDirect }
  }, onError: (cause: Error, variables, context) => { if (context?.previous) client.setQueryData(reelKey, context.previous); if (context?.previousDirect) client.setQueryData(['reel', variables.id], context.previousDirect); setReactionError(cause.message) }, onSuccess: updated => { client.setQueryData<Page<Reel>>(reelKey, old => old && ({ ...old, items: old.items.map(item => item.public_id === updated.public_id ? updated : item) })); client.setQueryData(['reel', updated.public_id], updated) }, onSettled: () => void client.invalidateQueries({ queryKey: reelKey }) })
  const toggleBookmark = useMutation({ mutationFn: ({ id, bookmarked }: { id: string; bookmarked: boolean }) => api<Reel>(`/reels/${id}/bookmark`, { method: bookmarked ? 'DELETE' : 'POST' }), onMutate: async ({ id, bookmarked }) => {
    await client.cancelQueries({ queryKey: reelKey })
    const previous = client.getQueryData<Page<Reel>>(reelKey)
    const previousDirect = client.getQueryData<Reel>(['reel', id])
    client.setQueryData<Page<Reel>>(reelKey, old => old && ({ ...old, items: old.items.map(item => item.public_id === id ? { ...item, bookmarked: !bookmarked } : item) }))
    client.setQueryData<Reel>(['reel', id], old => old && ({ ...old, bookmarked: !bookmarked }))
    return { previous, previousDirect }
  }, onError: (cause: Error, variables, context) => { if (context?.previous) client.setQueryData(reelKey, context.previous); if (context?.previousDirect) client.setQueryData(['reel', variables.id], context.previousDirect); setReactionError(cause.message) }, onSuccess: updated => { client.setQueryData<Page<Reel>>(reelKey, old => old && ({ ...old, items: old.items.map(item => item.public_id === updated.public_id ? updated : item) })); client.setQueryData(['reel', updated.public_id], updated) }, onSettled: () => void client.invalidateQueries({ queryKey: reelKey }) })
  const votePoll = useMutation({ mutationFn: ({ id, optionId }: { id: string; optionId: number }) => api<Reel>(`/reels/${id}/poll/vote`, { method: 'POST', body: { option_id: optionId } }), onSuccess: updated => { client.setQueryData<Page<Reel>>(reelKey, old => old && ({ ...old, items: old.items.map(item => item.public_id === updated.public_id ? updated : item) })); client.setQueryData(['reel', updated.public_id], updated) }, onError: (cause: Error) => setReactionError(cause.message) })
  const shareChat = useMutation({ mutationFn: (conversationId: number) => api(`/reels/${shareReelId}/share`, { method: 'POST', body: { conversation_id: conversationId } }), onSuccess: () => { setShareOpen(false); setShareNotice('Reel sent to chat'); void client.invalidateQueries({ queryKey: ['conversations'] }); void client.invalidateQueries({ queryKey: reelKey }); void client.invalidateQueries({ queryKey: ['reel', shareReelId] }) }, onError: (cause: Error) => setShareNotice(cause.message) })
  const followFromReel = useMutation({ mutationFn: (item: Reel) => api(`/social/profiles/${item.creator_id}/follow?source_kind=REEL&source_id=${item.id}`, { method: 'POST' }), onSuccess: () => { void client.invalidateQueries({ queryKey: reelKey }); void client.invalidateQueries({ queryKey: ['reel', targetId] }) }, onError: (cause: Error) => setReactionError(cause.message) })
  const addComment = useMutation({
    mutationFn: ({ reelId, content, parentId }: { reelId: string; content: string; parentId?: number }) => api<ReelComment>(`/reels/${reelId}/comments`, { method: 'POST', body: { content, parent_id: parentId } }),
    onSuccess: (posted, input) => {
      client.setQueryData<Page<ReelComment>>(['reel-comments', input.reelId], old => old && ({ ...old, items: [...old.items, posted] }))
      client.setQueryData<Page<Reel>>(reelKey, old => old && ({ ...old, items: old.items.map(item => item.public_id === input.reelId ? { ...item, comments_count: item.comments_count + 1 } : item) }))
      client.setQueryData<Reel>(['reel', input.reelId], old => old && ({ ...old, comments_count: old.comments_count + 1 }))
      setComment(''); setReplyToComment(null); setCommentError('')
      void client.invalidateQueries({ queryKey: ['reel-comments', input.reelId] })
      void client.invalidateQueries({ queryKey: reelKey })
    },
    onError: (cause: Error) => setCommentError(cause.message),
  })
  const likeComment = useMutation({
    mutationFn: ({ reelId, item }: { reelId: string; item: ReelComment }) => api<ReelComment>(`/reels/${reelId}/comments/${item.id}/like`, { method: item.liked ? 'DELETE' : 'POST' }),
    onSuccess: (updated, input) => client.setQueryData<Page<ReelComment>>(['reel-comments', input.reelId], old => old && ({ ...old, items: old.items.map(item => item.id === updated.id ? updated : item) })),
    onError: (cause: Error) => setCommentError(cause.message),
  })
  const deleteComment = useMutation({
    mutationFn: ({ reelId, commentId }: { reelId: string; commentId: number }) => api<{ deleted: boolean }>(`/reels/${reelId}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: (_, input) => {
      client.setQueryData<Page<ReelComment>>(['reel-comments', input.reelId], old => old && ({ ...old, items: old.items.filter(item => item.id !== input.commentId) }))
      client.setQueryData<Page<Reel>>(reelKey, old => old && ({ ...old, items: old.items.map(item => item.public_id === input.reelId ? { ...item, comments_count: Math.max(0, item.comments_count - 1) } : item) }))
      client.setQueryData<Reel>(['reel', input.reelId], old => old && ({ ...old, comments_count: Math.max(0, old.comments_count - 1) }))
      if (replyToComment?.id === input.commentId) setReplyToComment(null)
      setDeleteCommentTarget(null)
      setCommentError('')
      void client.invalidateQueries({ queryKey: ['reel-comments', input.reelId] })
      void client.invalidateQueries({ queryKey: reelKey })
    },
    onError: (cause: Error) => setCommentError(cause.message),
  })
  const create = useMutation({ mutationFn: () => {
    const form = new FormData()
    const hashtags = tags.split(/[\s,]+/).map(tag => tag.replace(/^#/, '').trim()).filter(tag => /^[A-Za-z0-9_]{1,50}$/.test(tag))
    form.append('video', video!)
    form.append('caption', [caption.trim(), ...hashtags.map(tag => `#${tag}`), ...taggedPeople.map(person => `@${person.username}`)].filter(Boolean).join('\n'))
    form.append('location', locationName.trim())
    form.append('publish', 'true')
    form.append('visibility', audience)
    form.append('allow_download', String(allowDownload))
    form.append('hide_like_count', String(hideLikeCount))
    form.append('hide_share_count', String(hideShareCount))
    form.append('poll_options', JSON.stringify(pollEnabled ? pollOptions.map(value => value.trim()).filter(Boolean) : []))
    if (scheduledAt) form.append('scheduled_at', new Date(scheduledAt).toISOString())
    return api<Reel>('/reels', { method: 'POST', body: form })
  }, onSuccess: created => { closeCreate(); setMode('mine'); setIndex(0); setParams({ id: created.public_id }); void client.invalidateQueries({ queryKey: ['reels'] }) }, onError: (cause: Error) => setUploadError(cause.message) })
  const edit = useMutation({ mutationFn: (body: object) => api<Reel>(`/reels/${reel!.public_id}`, { method: 'PATCH', body }), onSuccess: () => { setManageOpen(false); void client.invalidateQueries({ queryKey: ['reels'] }) }, onError: (cause: Error) => setUploadError(cause.message) })
  const closeCreate = () => {
    setCreateOpen(false); setVideo(null); setVideoPreview(''); setVideoDuration(0); setCaption(''); setTags('')
    setTagSearch(''); setTaggedPeople([]); setLocationName(''); setAudience('EVERYONE'); setScheduledAt('')
    setHideLikeCount(false); setHideShareCount(false); setAllowDownload(false); setPollEnabled(false)
    setPollOptions(['', '']); setUploadError('')
  }
  useEffect(() => () => { if (videoPreview) URL.revokeObjectURL(videoPreview) }, [videoPreview])
  const selectVideo = async (file: File | null) => {
    setVideo(null); setVideoPreview(''); setVideoDuration(0); setUploadError('')
    if (!file) return
    if (!['video/mp4', 'video/webm'].includes(file.type)) { setUploadError('Choose an MP4 or WebM video.'); return }
    if (file.size >= 50 * 1024 * 1024) { setUploadError('Reels must be smaller than 50 MB.'); return }
    const url = URL.createObjectURL(file)
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    const duration = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Could not read video duration.')), 15000)
      probe.onloadedmetadata = () => { clearTimeout(timeout); resolve(probe.duration) }
      probe.onerror = () => { clearTimeout(timeout); reject(new Error('Could not read this video.')) }
      probe.src = url
    }).catch((cause: Error) => { setUploadError(cause.message); return 0 })
    if (!Number.isFinite(duration) || duration < 1 || duration >= 60) {
      if (duration) setUploadError('Choose a Reel between 1 and 59 seconds.')
      URL.revokeObjectURL(url)
      return
    }
    setVideo(file); setVideoPreview(url); setVideoDuration(duration)
  }
  const copyLink = async () => {
    if (!shareReelId) return
    try { await navigator.clipboard.writeText(`${location.origin}/app/reels?id=${shareReelId}`); setShareNotice('Link copied') }
    catch { setShareNotice('Could not copy the link. Try your browser share menu.') }
  }
  const move = (delta: number) => {
    const next = activeIndex + delta
    if (next < 0 || next >= items.length) return
    feedRef.current?.scrollTo({ top: next * feedRef.current.clientHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  useEffect(() => () => { if (scrollCommitTimer.current) clearTimeout(scrollCommitTimer.current) }, [mode])
  useEffect(() => {
    if (!items.length || !feedRef.current) return
    const key = mode
    if (positionedFor.current === key) return
    positionedFor.current = key
    const target = targetId ? items.findIndex(item => item.public_id === targetId) : 0
    positioning.current = true
    feedRef.current.scrollTop = Math.max(0, target) * feedRef.current.clientHeight
    requestAnimationFrame(() => { positioning.current = false })
  }, [list.data, directReel.data, mode, targetId])
  useEffect(() => {
    feedRef.current?.querySelectorAll('video').forEach(video => { if (video !== videoRef.current) video.pause() })
    if (videoRef.current) videoRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }, [reel?.public_id])
  useEffect(() => {
    const feed = feedRef.current
    if (!feed) return
    const onWheel = (event: WheelEvent) => {
      if (showComments || manageOpen || createOpen || shareOpen || Math.abs(event.deltaY) < 10) return
      event.preventDefault()
      if (Date.now() < wheelLockedUntil.current) return
      wheelLockedUntil.current = Date.now() + 520
      move(event.deltaY > 0 ? 1 : -1)
    }
    feed.addEventListener('wheel', onWheel, { passive: false })
    return () => feed.removeEventListener('wheel', onWheel)
  }, [activeIndex, items.length, showComments, manageOpen, createOpen, shareOpen])
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (showComments || manageOpen || createOpen || shareOpen || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return; if (event.key === 'ArrowDown') move(1); if (event.key === 'ArrowUp') move(-1) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [activeIndex, items.length, showComments, manageOpen, createOpen, shareOpen])
  const togglePlay = () => { if (!videoRef.current) return; if (videoRef.current.paused) { void videoRef.current.play(); setPlaying(true) } else { videoRef.current.pause(); setPlaying(false) } }
  const onFeedScroll = () => {
    const feed = feedRef.current
    if (!feed || positioning.current || !items.length || showComments) return
    if (scrollCommitTimer.current) clearTimeout(scrollCommitTimer.current)
    scrollCommitTimer.current = setTimeout(() => {
      const currentFeed = feedRef.current
      if (!currentFeed || !items.length) return
      const next = Math.min(items.length - 1, Math.max(0, Math.round(currentFeed.scrollTop / currentFeed.clientHeight)))
      if (next === activeIndex) return
      setIndex(next)
      setParams({ id: items[next].public_id }, { replace: true })
    }, 110)
  }
  return <Shell active="Reels"><header className="page-header"><h1>Reels</h1><button className="header-icon" onClick={() => setCreateOpen(true)} title="Create Reel" aria-label="Create Reel"><Plus size={23} /></button></header><div className="reel-mode-tabs">{(['for_you', 'following', 'trending', 'new', 'saved', 'mine', 'archive'] as const).map(value => <button key={value} className={mode === value ? 'active' : ''} onClick={() => { if (scrollCommitTimer.current) clearTimeout(scrollCommitTimer.current); setMode(value); setIndex(0); setParams({}) }}>{value === 'for_you' ? 'For you' : value === 'mine' ? 'My Reels' : value === 'archive' ? 'Archive' : value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    {(list.isPending || (targetId && !targetInFeed && directReel.isPending)) && <div className="loading-list">Finding Reels…</div>}
    {list.error && <ErrorBox error={list.error} retry={() => void list.refetch()} />}
    {directReel.error && targetId && !targetInFeed && <Empty title="Reel unavailable">This Reel may have been removed or you may not have access.</Empty>}
    {(list.data || directReel.data) && !(targetId && !targetInFeed && (directReel.isPending || directReel.error)) && (items.length ? <div className="reels-feed" ref={feedRef} onScroll={onFeedScroll} aria-label="Reels feed">
      {items.map((item, slideIndex) => {
        const isActive = slideIndex === activeIndex
        return <div className="reels-stage" key={item.public_id} data-reel-id={item.public_id}>
          <div className="reels-frame">
            <video ref={isActive ? videoRef : undefined} src={Math.abs(slideIndex - activeIndex) <= 1 ? mediaUrl(item.video_url) : undefined} poster={mediaUrl(item.thumbnail_url)} preload={Math.abs(slideIndex - activeIndex) <= 1 ? 'metadata' : 'none'} playsInline loop autoPlay={isActive} muted={muted || !isActive} onClick={isActive ? togglePlay : () => move(slideIndex - activeIndex)} onPlay={isActive ? playback.onPlay : undefined} onPlaying={isActive ? playback.onPlaying : undefined} onPause={isActive ? playback.onPause : undefined} onWaiting={isActive ? playback.onWaiting : undefined} onTimeUpdate={isActive ? playback.onTimeUpdate : undefined} aria-label={`Reel by ${item.creator.username}`} />
            <div className="reel-shade" />
            <div className="reel-top"><span>REEL</span>{isActive && <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX size={22} /> : <Volume2 size={22} />}</button>}</div>
            {isActive && item.creator_id === me?.id && item.status !== 'PUBLISHED' && <div className="reel-publish-state" role="status"><strong>{item.status === 'READY' && item.scheduled_at ? 'Scheduled Reel' : item.status === 'READY' ? 'Ready to publish' : item.status === 'FAILED' ? 'Processing failed' : item.status === 'ARCHIVED' ? 'Archived Reel' : 'Processing Reel'}</strong><span>{item.status === 'READY' && item.scheduled_at ? `Publishes ${new Date(item.scheduled_at).toLocaleString()}` : item.status === 'READY' ? 'Only you can see this Reel until you publish it.' : item.status === 'FAILED' ? item.error || 'Try another MP4 or WebM video.' : item.status === 'ARCHIVED' ? 'Only you can see this Reel.' : item.publish_requested ? 'Your Reel will appear in feeds when processing finishes.' : 'Only you can see this Reel until you publish it.'}</span>{item.status === 'READY' && <button className="button primary" disabled={edit.isPending} onClick={() => edit.mutate({ publish: true })}>Publish now</button>}</div>}
            {isActive && <button className={`reel-play ${playing ? '' : 'paused'}`} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={25} /> : <Play size={25} />}</button>}
            {isActive && !!item.poll?.length && item.my_poll_vote == null && item.creator_id !== me?.id && <div className="reel-poll"><strong>Quick poll</strong>{item.poll.map(option => <button key={option.id} disabled={item.status !== 'PUBLISHED' || votePoll.isPending} onClick={() => votePoll.mutate({ id: item.public_id, optionId: option.id })}><span>{option.label}</span></button>)}</div>}
            <div className="reel-caption">{item.partnership_label && <small className="reel-partnership">Paid partnership{item.partnership_partner ? ` · ${item.partnership_partner}` : ""}</small>}<div className="reel-author-line"><Link to={`/profile/${item.creator_id}`}><Avatar user={item.creator} size="sm" /><strong>@{item.creator.username}</strong></Link>{isActive && item.creator_id !== me?.id && !item.following && <button type="button" disabled={followFromReel.isPending} onClick={() => followFromReel.mutate(item)}>Follow</button>}</div>{item.location && <small className="reel-location"><MapPin size={12} />{item.location}</small>}<p>{item.caption}</p></div>
          </div>
          {isActive && <div className="reel-side-actions">{item.creator_id === me?.id && <><button onClick={() => { setManageOpen(true); setUploadError('') }} aria-label="Manage Reel"><MoreHorizontal /><span>Manage</span></button><Link to={`/professional-dashboard/insights/REEL/${item.id}`} aria-label="View Reel insights"><BarChart3 /><span>Insights</span></Link></>}<button className={item.liked ? 'liked' : ''} disabled={toggleLike.isPending} onClick={() => toggleLike.mutate({ id: item.public_id, liked: item.liked })} aria-label={item.liked ? 'Unlike Reel' : 'Like Reel'}><Heart fill={item.liked ? 'currentColor' : 'none'} /><span>{item.likes_count == null ? 'Like' : item.likes_count}</span></button><button onClick={() => setShowComments(true)} aria-label="Comments"><MessageCircle /><span>{item.comments_count}</span></button><button onClick={() => { setShareReelId(item.public_id); setShareNotice(''); setShareOpen(true) }} aria-label="Share Reel"><Send /><span>{item.shares_count == null ? 'Share' : item.shares_count || 'Share'}</span></button><button disabled={toggleBookmark.isPending} onClick={() => toggleBookmark.mutate({ id: item.public_id, bookmarked: item.bookmarked })} aria-label={item.bookmarked ? 'Unsave Reel' : 'Save Reel'}><Bookmark fill={item.bookmarked ? 'currentColor' : 'none'} /><span>{item.bookmarked ? 'Saved' : 'Save'}</span></button>{item.allow_download && item.download_url && <a href={mediaUrl(item.download_url)} download={`reel-${item.public_id}.mp4`} aria-label="Download Reel"><Download /><span>Download</span></a>}</div>}
          {isActive && <div className="reel-step"><button disabled={activeIndex === 0} onClick={() => move(-1)} aria-label="Previous Reel"><ChevronUp /></button><button disabled={activeIndex === items.length - 1} onClick={() => move(1)} aria-label="Next Reel"><ChevronDown /></button></div>}
        </div>
      })}
    </div> : <Empty title="No Reels yet" icon={<PlaySquare size={35} />}>There are no videos in this view. <button className="text-button" onClick={() => setCreateOpen(true)}>Create a Reel</button> to get started.</Empty>)}
    {reactionError && <div className="reel-feedback" role="alert">{reactionError}<button onClick={() => setReactionError('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {shareNotice && !shareOpen && <div className="reel-feedback" role="status">{shareNotice}<button onClick={() => setShareNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {shareOpen && shareReelId && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShareOpen(false) }}><div className="dialog-card reel-share-dialog" role="dialog" aria-modal="true" aria-labelledby="reel-share-title"><header><div><h2 id="reel-share-title">Share this Reel</h2><p>Send it to a chat or copy its link.</p></div><button className="icon-button" onClick={() => setShareOpen(false)} aria-label="Close share dialog"><X /></button></header><div className="reel-share-body"><button className="reel-copy-link" onClick={() => void copyLink()}><Copy size={19} /> Copy link</button><h3>Send in chat</h3>{conversations.isPending && <p className="muted">Loading chats…</p>}{conversations.error && <ErrorBox error={conversations.error} retry={() => void conversations.refetch()} />}{conversations.data?.length ? <div className="reel-share-chats">{conversations.data.filter(conv => !conv.is_locked || conv.is_unlocked).map(conv => <button key={conv.id} disabled={shareChat.isPending} onClick={() => shareChat.mutate(conv.id)}><Avatar user={conv.other_user || { id: conv.id, username: conv.name || 'Group' }} size="sm" /><span><strong>{conv.name || conv.other_user?.display_name || conv.other_user?.username || 'Conversation'}</strong><small>{conv.type === 'GROUP' ? 'Group chat' : 'Direct message'}</small></span><Send size={17} /></button>)}</div> : !conversations.isPending && <p className="muted">No chats yet. Start a chat to share this Reel.</p>}{shareNotice && <p className="form-error" role="status">{shareNotice}</p>}</div></div></div>}
    {createOpen && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeCreate() }}><div className="dialog-card reel-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-reel-title"><header><div><h2 id="create-reel-title">Create a Reel</h2><p>Share a moment in under 60 seconds.</p></div><button className="icon-button" onClick={closeCreate} aria-label="Close"><X /></button></header><form className="reel-create-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (video && (!pollEnabled || pollOptions.filter(value => value.trim()).length >= 2)) create.mutate() }}>
      <div className="reel-create-media"><label className="reel-file-picker">{videoPreview ? <video src={videoPreview} controls playsInline muted /> : <><PlaySquare size={38} /><strong>Choose a video</strong><span>MP4 or WebM · under 60 seconds · under 50 MB</span></>}<input type="file" accept="video/mp4,video/webm" onChange={event => void selectVideo(event.target.files?.[0] || null)} /></label>{video && <p><Check size={15} /> {video.name} · {Math.round(videoDuration)} seconds</p>}</div>
      <div className="reel-create-fields"><label>Caption<textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={1800} placeholder="Tell the story behind this Reel…" /></label><div className="reel-create-grid"><label>Hashtags<input value={tags} onChange={event => setTags(event.target.value)} placeholder="#travel, #friends" /></label><label>Location<input value={locationName} onChange={event => setLocationName(event.target.value)} maxLength={120} placeholder="Add a place" /></label></div><label>Tag people<input value={tagSearch} onChange={event => setTagSearch(event.target.value)} placeholder="Search usernames" /></label>{suggestions.data && tagSearch && <div className="reel-tag-suggestions">{suggestions.data.filter(person => !taggedPeople.some(tagged => tagged.id === person.id)).map(person => <button type="button" key={person.id} onClick={() => { setTaggedPeople(current => [...current, person]); setTagSearch('') }}><Avatar user={person} size="sm" />@{person.username}</button>)}</div>}{!!taggedPeople.length && <div className="reel-tagged-people">{taggedPeople.map(person => <button type="button" key={person.id} onClick={() => setTaggedPeople(current => current.filter(value => value.id !== person.id))}>@{person.username} <X size={13} /></button>)}</div>}
        <div className="reel-create-grid"><label>Audience<select value={audience} onChange={event => setAudience(event.target.value as typeof audience)}><option value="EVERYONE">Everyone</option><option value="FOLLOWERS">Followers</option><option value="FRIENDS">Mutual followers</option><option value="ONLY_ME">Only me</option></select></label><label>Schedule (optional)<input type="datetime-local" value={scheduledAt} min={new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={event => setScheduledAt(event.target.value)} /></label></div>
        <div className="reel-create-options"><label><input type="checkbox" checked={pollEnabled} onChange={event => setPollEnabled(event.target.checked)} /> Add a poll</label>{pollEnabled && <div className="reel-poll-editor">{pollOptions.map((value, optionIndex) => <input key={optionIndex} value={value} maxLength={100} placeholder={`Option ${optionIndex + 1}`} onChange={event => setPollOptions(current => current.map((option, index) => index === optionIndex ? event.target.value : option))} />)}{pollOptions.length < 4 && <button type="button" onClick={() => setPollOptions(current => [...current, ''])}>+ Add option</button>}{pollOptions.length > 2 && <button type="button" onClick={() => setPollOptions(current => current.slice(0, -1))}>Remove last</button>}</div>}<label><input type="checkbox" checked={hideLikeCount} onChange={event => setHideLikeCount(event.target.checked)} /> Hide like count</label><label><input type="checkbox" checked={hideShareCount} onChange={event => setHideShareCount(event.target.checked)} /> Hide share count</label><label><input type="checkbox" checked={allowDownload} onChange={event => setAllowDownload(event.target.checked)} /> Allow downloads</label></div>
        {uploadError && <p className="form-error" role="alert">{uploadError}</p>}<button className="button primary reel-publish-button" disabled={!video || create.isPending || (pollEnabled && pollOptions.filter(value => value.trim()).length < 2)}>{create.isPending ? 'Uploading…' : scheduledAt ? <><CalendarClock size={18} /> Schedule Reel</> : 'Publish Reel'}</button><small>Video processing may take a moment. Your Reel appears in feeds when ready.</small></div>
    </form></div></div>}
    {manageOpen && reel && <ReelManageSheet key={reel.public_id} reel={reel} close={() => setManageOpen(false)} deleted={() => { setManageOpen(false); setIndex(0); setParams({}) }} />}
    {showComments && reel && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowComments(false) }}>
      <div className="dialog-card comments-card" role="dialog" aria-modal="true" aria-labelledby="comments-title">
        <header><div><h2 id="comments-title">Comments <span className="comments-count">{reel.comments_count}</span></h2><p>Join the conversation</p></div><button className="icon-button" onClick={() => setShowComments(false)} aria-label="Close comments"><X size={21} /></button></header>
        <div className="comments-list">
          {!!reel.poll?.length && (reel.my_poll_vote != null || reel.creator_id === me?.id) && <section className="comment-poll-results" aria-label="Poll results"><strong>Poll results</strong>{reel.poll.map(option => <div className={reel.my_poll_vote === option.id ? 'selected' : ''} key={option.id}><span>{option.label}</span><b>{reel.poll_total ? Math.round((option.votes || 0) / reel.poll_total * 100) : 0}%</b></div>)}<small>{reel.poll_total || 0} votes</small></section>}
          {comments.isPending && <p className="muted">Loading comments…</p>}
          {comments.error && <ErrorBox error={comments.error} retry={() => void comments.refetch()} />}
          {comments.data?.items.map(item => <article className={`comment-row ${item.parent_id ? 'comment-reply' : ''}`} key={item.id}>
            <Link className="comment-author-avatar" to={`/profile/${item.author?.id}`} onClick={() => setShowComments(false)} aria-label={`View ${item.author?.display_name || item.author?.username || 'commenter'}'s profile`}><Avatar user={item.author} size="sm" /></Link>
            <div className="comment-content"><div className="comment-byline"><Link to={`/profile/${item.author?.id}`} onClick={() => setShowComments(false)}>{item.author?.display_name || item.author?.username || 'Member'}</Link>{item.pinned && <span className="comment-pinned">Pinned</span>}<time title={new Date(item.created_at).toLocaleString()}>{timeAgo(item.created_at)}</time></div><p>{item.content}</p><div className="comment-row-actions"><button type="button" className="comment-reply-button" onClick={() => { setReplyToComment(item); setCommentError('') }}>Reply</button>{(item.author?.id === me?.id || reel.creator_id === me?.id) && <button type="button" className="comment-delete-button" disabled={deleteComment.isPending} onClick={() => { setDeleteCommentTarget(item); setCommentError('') }}>Delete</button>}</div></div>
            <button type="button" className={`comment-like ${item.liked ? 'liked' : ''}`} aria-label={item.liked ? 'Unlike comment' : 'Like comment'} disabled={likeComment.isPending} onClick={() => likeComment.mutate({ reelId: reel.public_id, item })}><Heart size={17} fill={item.liked ? 'currentColor' : 'none'} /><span>{item.likes_count || ''}</span></button>
          </article>)}
          {comments.data?.items.length === 0 && <div className="comments-empty"><MessageCircle size={32} /><strong>No comments yet</strong><span>Be the first to say something.</span></div>}
        </div>
        <form className="comment-form" onSubmit={event => { event.preventDefault(); if (reel.allow_comments && comment.trim() && !addComment.isPending) addComment.mutate({ reelId: reel.public_id, content: comment.trim(), parentId: replyToComment?.id }) }}>
          {replyToComment && <div className="comment-replying">Replying to <strong>@{replyToComment.author?.username}</strong><button type="button" onClick={() => setReplyToComment(null)} aria-label="Cancel reply"><X size={15} /></button></div>}
          {commentError && <p className="form-error" role="alert">{commentError}</p>}
          {!reel.allow_comments && <p className="muted">Commenting is turned off for this Reel.</p>}<div className="comment-composer"><Avatar user={me || undefined} size="sm" /><input value={comment} maxLength={2000} onChange={event => { setComment(event.target.value); if (commentError) setCommentError('') }} placeholder={replyToComment ? 'Write a reply…' : 'Write a comment…'} aria-label={replyToComment ? 'Write a reply' : 'Write a comment'} /><button type="submit" disabled={!reel.allow_comments || !comment.trim() || addComment.isPending} aria-label={addComment.isPending ? 'Posting comment' : 'Post comment'}>{addComment.isPending ? 'Posting…' : <Send size={19} />}</button></div>
        </form>
      </div>
    </div>}
    {deleteCommentTarget && reel && <div className="dialog-backdrop reel-confirm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !deleteComment.isPending) setDeleteCommentTarget(null) }}>
      <div className="dialog-card reel-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-comment-title" aria-describedby="delete-comment-description">
        <div className="reel-confirm-icon"><MessageCircle size={22} /></div>
        <h2 id="delete-comment-title">Delete comment?</h2>
        <p id="delete-comment-description">This comment will be removed from the Reel for everyone.</p>
        {commentError && <p className="form-error" role="alert">{commentError}</p>}
        <div className="reel-confirm-actions"><button type="button" className="button secondary" disabled={deleteComment.isPending} onClick={() => setDeleteCommentTarget(null)}>Cancel</button><button type="button" className="button danger" disabled={deleteComment.isPending} onClick={() => deleteComment.mutate({ reelId: reel.public_id, commentId: deleteCommentTarget.id })}>{deleteComment.isPending ? 'Deleting…' : 'Delete comment'}</button></div>
      </div>
    </div>}
  </Shell>
}
