import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag, Plus, Send, X } from 'lucide-react'
import { api, imagePreviewUrl, mediaUrl, upload } from './api'
import { Avatar, ErrorBox } from './components'
import { useAuth } from './store'
import type { StoryGroup } from './types'
import { ReportDialog } from './ReportDialog'

type Story = { id: number; user_id: number; media_url: string; media_type: string; caption?: string; views_count: number }
type FullGroup = Omit<StoryGroup, 'stories'> & { stories: Story[] }

export function StoriesStrip() {
  const me = useAuth(state => state.user)
  const client = useQueryClient()
  const groups = useQuery({ queryKey: ['stories'], queryFn: () => api<FullGroup[]>('/stories') })
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<FullGroup | null>(null)
  const [index, setIndex] = useState(0)
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [progress, setProgress] = useState(0)
  const paused = useRef(false)
  const story = selected?.stories[index]
  const nextStory = selected?.stories[index + 1]
  const nextImageUrl = nextStory?.media_type === 'IMAGE' ? imagePreviewUrl(nextStory.media_url, 960) : ''
  useEffect(() => { if (story && story.user_id !== me?.id) void api(`/stories/${story.id}/view`, { method: 'POST' }).catch(() => {}) }, [story?.id, story?.user_id, me?.id])
  useEffect(() => { if (nextImageUrl) { const image = new Image(); image.src = nextImageUrl } }, [nextImageUrl])
  useEffect(() => {
    if (!story) return
    setProgress(0)
    if (story.media_type === 'VIDEO') return
    let elapsed = 0
    const timer = window.setInterval(() => {
      if (paused.current) return
      elapsed += 50
      setProgress(Math.min(1, elapsed / 6000))
      if (elapsed >= 6000) {
        window.clearInterval(timer)
        if (selected && index < selected.stories.length - 1) setIndex(index + 1)
        else setSelected(null)
      }
    }, 50)
    return () => window.clearInterval(timer)
  }, [story?.id, selected, index])
  useEffect(() => {
    if (!selected) return
    const navigate = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowRight') { if (index < selected.stories.length - 1) setIndex(index + 1); else setSelected(null) }
      if (event.key === 'ArrowLeft' && index > 0) setIndex(index - 1)
    }
    document.addEventListener('keydown', navigate)
    return () => document.removeEventListener('keydown', navigate)
  }, [selected, index])
  const create = useMutation({ mutationFn: async () => {
    const media = file ? await upload(file) : null
    return api('/stories', { method: 'POST', body: { media_url: media?.file_url || '', media_type: file ? file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE' : 'TEXT', caption } })
  }, onSuccess: () => { setCreateOpen(false); setCaption(''); setFile(null); setError(''); void client.invalidateQueries({ queryKey: ['stories'] }) }, onError: (cause: Error) => setError(cause.message) })
  const sendReply = useMutation({ mutationFn: () => api(`/stories/${story!.id}/reply`, { method: 'POST', body: { content: reply } }), onSuccess: () => { setReply(''); setSelected(null) }, onError: (cause: Error) => setError(cause.message) })
  const remove = useMutation({ mutationFn: () => api(`/stories/${story!.id}`, { method: 'DELETE' }), onSuccess: () => { setSelected(null); void client.invalidateQueries({ queryKey: ['stories'] }) } })
  return <><div className="stories-strip"><button className="story-tile" onClick={() => setCreateOpen(true)}><span className="story-ring"><Avatar user={me} size="lg" /></span><span>Your story <Plus size={12} /></span></button>{groups.data?.map(group => <button key={group.user_id} className="story-tile" onClick={() => { setSelected(group); setIndex(0); setError('') }}><span className={`story-ring ${group.all_viewed ? 'viewed' : ''}`}><Avatar user={{ id: group.user_id, username: group.username || '', display_name: group.display_name, avatar_url: group.avatar_url }} size="lg" /></span><span>{group.user_id === me?.id ? 'Your stories' : group.display_name || group.username}</span></button>)}</div>{groups.error && <ErrorBox error={groups.error} />}
    {createOpen && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreateOpen(false) }}><div className="dialog-card" role="dialog" aria-modal="true" aria-label="New story"><header><h2>New story</h2><button className="icon-button" onClick={() => setCreateOpen(false)} aria-label="Close new story"><X /></button></header><form className="profile-edit-form" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate() }}><label>Caption or text<textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={500} /></label><label>Photo or video (optional)<input type="file" accept="image/*,video/mp4" onChange={event => setFile(event.target.files?.[0] || null)} /></label>{error && <p className="form-error">{error}</p>}<button className="button primary" disabled={create.isPending || (!file && !caption.trim())}>{create.isPending ? 'Sharing…' : 'Share story'}</button></form></div></div>}
    {selected && story && <div className="dialog-backdrop"><div className="story-viewer" role="dialog" aria-modal="true" aria-label="Story viewer"><div className="story-progress" aria-label={`Story ${index + 1} of ${selected.stories.length}`}>{selected.stories.map((entry, position) => <span className="story-progress-track" key={entry.id}><span style={{ width: position < index ? '100%' : position === index ? `${Math.round(progress * 100)}%` : '0%' }} /></span>)}</div><header><Avatar user={{ id:selected.user_id, username:selected.username || '', display_name:selected.display_name, avatar_url:selected.avatar_url }} size="sm" /><strong>{selected.display_name || selected.username}</strong><span>{index + 1} / {selected.stories.length}</span>{selected.user_id !== me?.id && <button className="icon-button" onClick={() => setReportOpen(true)} aria-label="Report story"><Flag size={18} /></button>}<button className="icon-button" onClick={() => setSelected(null)} aria-label="Close story"><X /></button></header><div className="story-media">{story.media_type === 'IMAGE' ? <img src={imagePreviewUrl(story.media_url, 960)} alt={story.caption || 'Story'} decoding="async" /> : story.media_type === 'VIDEO' ? <video src={mediaUrl(story.media_url)} controls autoPlay playsInline preload="metadata" onTimeUpdate={event => { const video = event.currentTarget; if (video.duration) setProgress(video.currentTime / video.duration) }} onEnded={() => { if (index < selected.stories.length - 1) setIndex(index + 1); else setSelected(null) }} /> : <p>{story.caption}</p>}</div>{story.media_type !== 'TEXT' && story.caption && <p className="story-caption">{story.caption}</p>}<footer>{index > 0 && <button className="story-step" onClick={() => setIndex(index - 1)}>Previous</button>}{index < selected.stories.length - 1 && <button className="story-step" onClick={() => setIndex(index + 1)}>Next</button>}{selected.user_id === me?.id ? <button className="story-delete" onClick={() => { if (confirm('Delete this story?')) remove.mutate() }}>Delete story · {story.views_count} {story.views_count === 1 ? 'view' : 'views'}</button> : <form onSubmit={(event: FormEvent) => { event.preventDefault(); if (reply.trim()) sendReply.mutate() }}><input value={reply} onChange={event => setReply(event.target.value)} onFocus={() => { paused.current = true }} onBlur={() => { paused.current = false }} placeholder="Reply to story" /><button disabled={!reply.trim()} aria-label="Send reply"><Send size={18} /></button></form>}</footer>{error && <p className="form-error">{error}</p>}</div></div>}{selected && story && reportOpen && <ReportDialog entityType="story" entityId={story.id} onClose={() => setReportOpen(false)} />}
  </>
}
