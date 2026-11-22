import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Archive, BarChart3, BookmarkX, Camera, Check, Download, EyeOff, HeartOff, Image, Lock, MapPin, MessageCircleOff, Package, Pin, ShieldCheck, Trash2, X } from 'lucide-react'
import { api, mediaUrl } from './api'
import type { Reel } from './types'

type View = 'menu' | 'edit' | 'preview' | 'partner' | 'archive' | 'delete'
type Props = { reel: Reel; close: () => void; deleted: () => void }

export function ReelManageSheet({ reel, close, deleted }: Props) {
  const client = useQueryClient()
  const [current, setCurrent] = useState(reel)
  const [view, setView] = useState<View>('menu')
  const [caption, setCaption] = useState(reel.caption)
  const [location, setLocation] = useState(reel.location || '')
  const [visibility, setVisibility] = useState(reel.visibility || 'EVERYONE')
  const [frame, setFrame] = useState(0)
  const [cropX, setCropX] = useState(reel.cover_crop_x ?? 50)
  const [cropY, setCropY] = useState(reel.cover_crop_y ?? 50)
  const [zoom, setZoom] = useState(reel.cover_zoom ?? 1)
  const [partnerLabel, setPartnerLabel] = useState(!!reel.partnership_label)
  const [partner, setPartner] = useState(reel.partnership_partner || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const touchY = useRef(0)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => { document.body.style.overflow = oldOverflow; previous?.focus() }
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab') return
    const controls = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || [])
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  const refreshed = (updated: Reel) => {
    setCurrent(updated)
    client.setQueryData(['reel', updated.public_id], updated)
    void client.invalidateQueries({ queryKey: ['reels'] })
    void client.invalidateQueries({ queryKey: ['profile-reels'] })
    void client.invalidateQueries({ queryKey: ['creator'] })
  }
  const change = async (body: object, success: string) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const updated = await api<Reel>(`/reels/${current.public_id}`, { method: 'PATCH', body })
      refreshed(updated); setNotice(success); setView('menu'); return true
    } catch (cause) { setError((cause as Error).message); return false }
    finally { setBusy(false) }
  }
  const cover = async (form: FormData, path: string, success: string) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const updated = await api<Reel>(`/reels/${current.public_id}/${path}`, { method: 'POST', body: form })
      refreshed(updated); setNotice(success)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setError('')
    try {
      await api(`/reels/${current.public_id}`, { method: 'DELETE' })
      void client.invalidateQueries({ queryKey: ['reels'] })
      void client.invalidateQueries({ queryKey: ['profile-reels'] })
      void client.invalidateQueries({ queryKey: ['creator'] })
      deleted()
    } catch (cause) { setError((cause as Error).message); setBusy(false) }
  }
  const option = (Icon: typeof Archive, title: string, detail: string, action?: () => void, unavailable = false, danger = false) =>
    <button type="button" className={`reel-manage-option${danger ? ' danger' : ''}`} disabled={busy || unavailable} onClick={action}><Icon size={19} /><span><strong>{title}</strong><small>{detail}</small></span>{unavailable ? <em>Unavailable</em> : <span aria-hidden="true">›</span>}</button>
  return <div className="dialog-backdrop reel-manage-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close() }}>
    <div ref={sheetRef} className="reel-manage-sheet" role="dialog" aria-modal="true" aria-labelledby="reel-manage-title" onKeyDown={onKeyDown}>
      <div className="reel-manage-grip" onTouchStart={event => { touchY.current = event.touches[0].clientY }} onTouchEnd={event => { if (!busy && event.changedTouches[0].clientY - touchY.current > 80) close() }}><span /></div>
      <header><div><small>YOUR REEL</small><h2 id="reel-manage-title">{view === 'menu' ? 'Manage Reel' : view === 'edit' ? 'Edit Reel' : view === 'preview' ? 'Adjust preview' : view === 'partner' ? 'Paid partnership' : view === 'archive' ? current.status === 'ARCHIVED' ? 'Restore Reel?' : 'Archive Reel?' : 'Delete Reel?'}</h2></div><button ref={closeRef} type="button" className="icon-button" aria-label="Close Reel management" onClick={close} disabled={busy}><X size={20} /></button></header>
      {error && <p className="form-error reel-manage-feedback" role="alert">{error}</p>}
      {notice && <p className="reel-manage-feedback success" role="status"><Check size={16} />{notice}</p>}
      {view === 'menu' && <div className="reel-manage-list">
        {option(Archive, current.status === 'ARCHIVED' ? 'Restore Reel' : 'Archive', current.status === 'ARCHIVED' ? 'Return to feeds and your profile' : 'Keep this Reel and its activity private', () => setView('archive'), !['PUBLISHED', 'ARCHIVED'].includes(current.status))}
        {option(HeartOff, current.hide_like_count ? 'Unhide like count to others' : 'Hide like count to others', 'Likes still appear in your insights', () => void change({ hide_like_count: !current.hide_like_count }, 'Like count setting saved'))}
        {option(EyeOff, current.hide_share_count ? 'Unhide share count' : 'Hide share count', 'Sharing remains available', () => void change({ hide_share_count: !current.hide_share_count }, 'Share count setting saved'))}
        {option(MessageCircleOff, current.allow_comments ? 'Turn off commenting' : 'Turn on commenting', 'Existing comments are kept', () => void change({ allow_comments: !current.allow_comments }, 'Comment setting saved'))}
        {option(Package, 'Suggested products', 'No product catalog is connected', undefined, true)}
        {option(Download, current.allow_download ? 'Turn off downloading' : 'Turn on downloading', 'Controls Relaydot’s download action', () => void change({ allow_download: !current.allow_download }, 'Download setting saved'))}
        {option(MapPin, 'Edit', 'Caption, hashtags, mentions, location and audience', () => setView('edit'))}
        {option(Camera, 'Adjust preview', 'Choose a frame, cover and grid crop', () => setView('preview'))}
        <Link className="reel-manage-option" to={`/professional-dashboard/insights/REEL/${current.id}`} onClick={close}><BarChart3 size={19} /><span><strong>View Insights</strong><small>Activity and audience for this Reel</small></span><span aria-hidden="true">›</span></Link>
        {option(ShieldCheck, 'Partnership label and ads', 'Add a paid partnership disclosure; ads unavailable', () => setView('partner'), current.creator.account_type !== 'CREATOR')}
        {option(Lock, 'Reuse in Relaydot', 'Reel remix and reuse are not supported yet', undefined, true)}
        {option(BookmarkX, current.show_on_main_grid ? 'Remove from main grid' : 'Add to main grid', 'Keep the Reel in your Reels tab', () => void change({ show_on_main_grid: !current.show_on_main_grid }, 'Profile grid setting saved'), current.creator.account_type !== 'CREATOR')}
        {option(Pin, current.pinned ? 'Unpin from main grid' : 'Pin to your main grid', 'Up to three pinned Reels', () => void change({ pinned: !current.pinned }, current.pinned ? 'Reel unpinned' : 'Reel pinned'), current.creator.account_type !== 'CREATOR' || current.status !== 'PUBLISHED')}
        {option(Trash2, 'Delete Reel', 'Permanently remove media and public access', () => setView('delete'), false, true)}
      </div>}
      {view === 'edit' && <form className="reel-manage-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void change({ caption, location, visibility }, 'Reel details saved') }}><label>Caption<textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} /></label><small>Use #hashtags and @mentions in your caption.</small><label>Location<input value={location} onChange={event => setLocation(event.target.value)} maxLength={120} /></label><label>Audience<select value={visibility} onChange={event => setVisibility(event.target.value)}><option value="EVERYONE">Everyone</option><option value="FOLLOWERS">Followers</option><option value="FRIENDS">Friends</option><option value="ONLY_ME">Only me</option></select></label><div className="reel-manage-footer"><button type="button" className="button secondary" onClick={() => setView('menu')}>Back</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div></form>}
      {view === 'preview' && <div className="reel-manage-form"><div className="reel-cover-preview">{current.thumbnail_url ? <img src={mediaUrl(current.thumbnail_url)} alt="Reel grid preview" style={{ objectPosition: `${cropX}% ${cropY}%`, transform: `scale(${zoom})` }} /> : <Image size={36} />}</div><label>Video frame (seconds)<input type="range" min="0" max={Math.max(0, (current.duration || 1) - .1)} step=".1" value={frame} onChange={event => setFrame(Number(event.target.value))} /><small>{frame.toFixed(1)}s</small></label><button type="button" className="button secondary" disabled={busy} onClick={() => { const form = new FormData(); form.append('time_seconds', String(frame)); void cover(form, 'cover', 'Cover frame saved') }}>Use this frame</button><label className="reel-cover-upload">Upload custom cover<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) { const form = new FormData(); form.append('image', file); void cover(form, 'cover-upload', 'Custom cover saved') } }} /></label><div className="reel-crop-controls"><label>Horizontal crop<input type="range" min="0" max="100" value={cropX} onChange={event => setCropX(Number(event.target.value))} /></label><label>Vertical crop<input type="range" min="0" max="100" value={cropY} onChange={event => setCropY(Number(event.target.value))} /></label><label>Zoom<input type="range" min="1" max="2" step=".05" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label></div><div className="reel-manage-footer"><button type="button" className="button secondary" onClick={() => setView('menu')}>Back</button><button type="button" className="button secondary" disabled={busy} onClick={() => { void change({ cover_crop_x: 50, cover_crop_y: 50, cover_zoom: 1 }, 'Crop reset').then(saved => { if (saved) { setCropX(50); setCropY(50); setZoom(1) } }) }}>Reset crop</button><button type="button" className="button primary" disabled={busy} onClick={() => void change({ cover_crop_x: cropX, cover_crop_y: cropY, cover_zoom: zoom }, 'Grid preview saved')}>Save preview</button></div></div>}
      {view === 'partner' && <form className="reel-manage-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void change({ partnership_label: partnerLabel, partnership_partner: partnerLabel ? partner : '' }, 'Partnership disclosure saved') }}><label className="reel-manage-check"><input type="checkbox" checked={partnerLabel} onChange={event => setPartnerLabel(event.target.checked)} /> Show paid partnership label</label><label>Partner name (optional)<input value={partner} onChange={event => setPartner(event.target.value)} maxLength={100} disabled={!partnerLabel} placeholder="Business or brand name" /></label><p className="muted">The name is creator supplied. Relaydot does not verify partners or offer ad campaigns.</p><div className="reel-manage-footer"><button type="button" className="button secondary" onClick={() => setView('menu')}>Back</button><button className="button primary" disabled={busy}>Save disclosure</button></div></form>}
      {view === 'archive' && <div className="reel-manage-confirm"><p>{current.status === 'ARCHIVED' ? 'Restore this Reel to feeds and your profile with its likes, comments and insights intact?' : 'Archive this Reel? Only you will be able to open it until you restore it. Likes, comments, media and insights are kept.'}</p><div className="reel-manage-footer"><button type="button" className="button secondary" onClick={() => setView('menu')}>Cancel</button><button type="button" className="button primary" disabled={busy} onClick={() => void change({ archive: current.status !== 'ARCHIVED' }, current.status === 'ARCHIVED' ? 'Reel restored' : 'Reel archived')}>{busy ? 'Saving…' : current.status === 'ARCHIVED' ? 'Restore Reel' : 'Archive Reel'}</button></div></div>}
      {view === 'delete' && <div className="reel-manage-confirm"><p>Delete this Reel? It will disappear from feeds and profiles. Its media files will be permanently removed. This cannot be undone.</p><div className="reel-manage-footer"><button type="button" className="button secondary" onClick={() => setView('menu')}>Cancel</button><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete Reel'}</button></div></div>}
    </div>
  </div>
}
