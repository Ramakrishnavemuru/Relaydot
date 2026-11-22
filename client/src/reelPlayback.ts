import { useEffect, useRef, type RefObject } from 'react'
import { api } from './api'

type EventName = 'START' | 'PROGRESS' | 'PAUSE' | 'RESUME' | 'SKIP' | 'COMPLETE' | 'REPLAY'
type Session = { id: string; reel: string; sequence: number; active: boolean; completed: boolean;
  lastMedia: number; lastWall: number; pendingMs: number; chain: Promise<unknown> }

export function useReelPlayback(publicId?: string, videoRef?: RefObject<HTMLVideoElement | null>) {
  const current = useRef<Session | null>(null)
  const send = (session: Session, event: EventName, deltaMs: number, positionMs: number) => {
    const sequence = event === 'START' ? 0 : ++session.sequence
    session.chain = session.chain.catch(() => {}).then(() => api(`/reels/${session.reel}/playback`, {
      method: 'POST', body: { session_id: session.id, sequence, event,
        delta_ms: Math.max(0, Math.min(10000, Math.round(deltaMs))),
        position_ms: Math.max(0, Math.min(180000, Math.round(positionMs))) },
    })).catch(() => {})
  }
  const position = () => Math.round((videoRef?.current?.currentTime || 0) * 1000)
  const flush = (session: Session, event: EventName) => {
    const video = videoRef?.current
    if (session.active && video && document.visibilityState === 'visible') {
      const now = performance.now()
      const mediaMs = Math.max(0, (video.currentTime - session.lastMedia) * 1000)
      const wallMs = Math.max(0, now - session.lastWall)
      session.pendingMs += Math.min(mediaMs, wallMs + 100)
      session.lastMedia = video.currentTime
      session.lastWall = now
    }
    send(session, event, session.pendingMs, position())
    session.pendingMs = 0
  }
  const pause = () => {
    const session = current.current
    if (!session?.active) return
    flush(session, 'PAUSE')
    session.active = false
  }
  const play = () => {
    if (!publicId || !videoRef?.current || document.visibilityState !== 'visible') return
    let session = current.current
    if (!session || session.reel !== publicId) {
      session = { id: crypto.randomUUID().replaceAll('-', ''), reel: publicId, sequence: 0,
        active: true, completed: false, lastMedia: videoRef.current.currentTime,
        lastWall: performance.now(), pendingMs: 0, chain: Promise.resolve() }
      current.current = session
      send(session, 'START', 0, position())
    } else if (!session.active) {
      session.active = true
      session.lastMedia = videoRef.current.currentTime
      session.lastWall = performance.now()
      send(session, 'RESUME', 0, position())
    }
  }
  const timeUpdate = () => {
    const session = current.current
    const video = videoRef?.current
    if (!session?.active || !video || video.paused || video.seeking || document.visibilityState !== 'visible') return
    if (session.completed && video.currentTime < session.lastMedia - 1) {
      send(session, 'REPLAY', 0, position())
      session.completed = false
      session.lastMedia = video.currentTime
      session.lastWall = performance.now()
    }
    const now = performance.now()
    const mediaMs = Math.max(0, (video.currentTime - session.lastMedia) * 1000)
    session.pendingMs += Math.min(mediaMs, Math.max(0, now - session.lastWall) + 100)
    session.lastMedia = video.currentTime
    session.lastWall = now
    if (session.pendingMs >= 3000) flush(session, 'PROGRESS')
    if (!session.completed && video.duration > 0 && video.currentTime >= video.duration * .98) {
      flush(session, 'COMPLETE')
      session.completed = true
    }
  }
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { pause(); videoRef?.current?.pause() }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      const session = current.current
      if (session && session.reel === publicId) {
        send(session, 'SKIP', session.pendingMs, Math.round(session.lastMedia * 1000))
        current.current = null
      }
    }
  }, [publicId])
  return { onPlay: play, onPlaying: play, onPause: pause, onWaiting: pause, onTimeUpdate: timeUpdate }
}
