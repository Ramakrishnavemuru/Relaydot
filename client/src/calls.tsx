import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, X } from 'lucide-react'
import { api } from './api'
import { Avatar } from './components'
import type { User } from './types'

type Call = { peer: User; type: 'audio' | 'video'; phase: 'incoming' | 'calling' | 'connecting' | 'connected' }
type Signal = { event: string; data: Record<string, unknown> }
type CallContextValue = { startCall: (peer: User, type: 'audio' | 'video') => Promise<void> }
const Context = createContext<CallContextValue | null>(null)
export const useCall = () => { const value = useContext(Context); if (!value) throw new Error('Call provider missing'); return value }
const send = (event: string, data: object) => window.dispatchEvent(new CustomEvent('relay-send-signal', { detail: { event, data } }))

export function CallProvider({ children }: { children: ReactNode }) {
  const [call, setCall] = useState<Call | null>(null)
  const callRef = useRef<Call | null>(null)
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const localStream = useRef<MediaStream | null>(null)
  const remoteStream = useRef<MediaStream | null>(null)
  const connection = useRef<RTCPeerConnection | null>(null)
  const pendingIce = useRef<RTCIceCandidateInit[]>([])
  const localVideo = useRef<HTMLVideoElement | null>(null)
  const remoteVideo = useRef<HTMLVideoElement | null>(null)
  const remoteAudio = useRef<HTMLAudioElement | null>(null)
  const update = (value: Call | null) => { callRef.current = value; setCall(value) }
  const end = useCallback((notify = true) => {
    const active = callRef.current
    if (active && notify) send('call_end', { target_user_id: active.peer.id })
    connection.current?.close(); connection.current = null
    localStream.current?.getTracks().forEach(track => track.stop()); localStream.current = null
    remoteStream.current = null; pendingIce.current = []
    callRef.current = null; setCall(null); setMuted(false); setCameraOff(false); setSeconds(0)
  }, [])
  const media = async (type: 'audio' | 'video') => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calls require HTTPS or localhost and a supported browser.')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' })
    localStream.current = stream
    if (localVideo.current) localVideo.current.srcObject = stream
  }
  const makeConnection = useCallback(async (peerId: number) => {
    const config = await api<{ ice_servers?: RTCIceServer[] }>('/calls/config').catch(() => ({ ice_servers: [{ urls: 'stun:stun.l.google.com:19302' }] }))
    const pc = new RTCPeerConnection({ iceServers: config.ice_servers })
    connection.current = pc
    const remote = new MediaStream(); remoteStream.current = remote
    pc.ontrack = event => { remote.addTrack(event.track); if (remoteVideo.current) remoteVideo.current.srcObject = remote; if (remoteAudio.current) remoteAudio.current.srcObject = remote }
    pc.onicecandidate = event => { if (event.candidate) send('ice_candidate', { target_user_id: peerId, candidate: event.candidate.toJSON() }) }
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected' && callRef.current) { update({ ...callRef.current, phase: 'connected' }); setSeconds(0) } else if (pc.connectionState === 'failed') setError('Call connection failed.') }
    localStream.current?.getTracks().forEach(track => pc.addTrack(track, localStream.current!))
    return pc
  }, [])
  const startCall = useCallback(async (peer: User, type: 'audio' | 'video') => {
    if (callRef.current) return
    setError('')
    try { await media(type); update({ peer, type, phase: 'calling' }); send('call_invite', { target_user_id: peer.id, call_type: type }) }
    catch (cause) { end(false); setError(cause instanceof Error ? cause.message : 'Could not start call.') }
  }, [end])
  const accept = async () => {
    const active = callRef.current
    if (!active) return
    try { await media(active.type); update({ ...active, phase: 'connecting' }); await makeConnection(active.peer.id); send('call_accept', { target_user_id: active.peer.id, call_type: active.type }) }
    catch (cause) { send('call_reject', { target_user_id: active.peer.id, reason: 'unavailable' }); end(false); setError(cause instanceof Error ? cause.message : 'Could not answer call.') }
  }
  const reject = () => { if (callRef.current) send('call_reject', { target_user_id: callRef.current.peer.id, reason: 'declined' }); end(false) }
  useEffect(() => {
    const onSignal = (event: Event) => {
      const { event: kind, data } = (event as CustomEvent<Signal>).detail
      const active = callRef.current
      void (async () => {
        try {
          if (kind === 'call_invite') {
            const id = Number(data.caller_id)
            if (active) { send('call_reject', { target_user_id: id, reason: 'busy' }); return }
            update({ peer: { id, username: String(data.caller_name || 'Contact'), display_name: String(data.caller_name || 'Contact'), avatar_url: typeof data.caller_avatar === 'string' ? data.caller_avatar : null }, type: data.call_type === 'video' ? 'video' : 'audio', phase: 'incoming' })
          } else if (kind === 'call_accept' && active?.phase === 'calling') {
            update({ ...active, phase: 'connecting' })
            const pc = await makeConnection(active.peer.id)
            const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
            send('webrtc_offer', { target_user_id: active.peer.id, offer: pc.localDescription?.toJSON() })
          } else if (kind === 'webrtc_offer' && active) {
            const pc = connection.current || await makeConnection(active.peer.id)
            await pc.setRemoteDescription(data.offer as RTCSessionDescriptionInit)
            for (const candidate of pendingIce.current.splice(0)) await pc.addIceCandidate(candidate)
            const answer = await pc.createAnswer(); await pc.setLocalDescription(answer)
            send('webrtc_answer', { target_user_id: active.peer.id, answer: pc.localDescription?.toJSON() })
          } else if (kind === 'webrtc_answer' && connection.current) {
            await connection.current.setRemoteDescription(data.answer as RTCSessionDescriptionInit)
            for (const candidate of pendingIce.current.splice(0)) await connection.current.addIceCandidate(candidate)
          } else if (kind === 'ice_candidate' && data.candidate) {
            if (connection.current?.remoteDescription) await connection.current.addIceCandidate(data.candidate as RTCIceCandidateInit)
            else pendingIce.current.push(data.candidate as RTCIceCandidateInit)
          } else if (kind === 'call_reject' || kind === 'call_end') {
            end(false)
            if (kind === 'call_reject') setError(String(data.message || 'Call declined or unavailable.'))
          }
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Call failed.'); end(true) }
      })()
    }
    window.addEventListener('relay-call', onSignal)
    return () => window.removeEventListener('relay-call', onSignal)
  }, [makeConnection, end])
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = localStream.current; if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream.current; if (remoteAudio.current) remoteAudio.current.srcObject = remoteStream.current }, [call?.phase, call?.type])
  useEffect(() => { if (call?.phase !== 'connected') return; const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer) }, [call?.phase])
  useEffect(() => () => end(false), [end])
  return <Context.Provider value={{ startCall }}>{children}{error && <div className="call-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss"><X size={15} /></button></div>}{call && <div className="call-backdrop"><div className="call-card" role="dialog" aria-modal="true" aria-label={`${call.type} call`}><div className="call-head"><Avatar user={call.peer} size="lg" /><h2>{call.peer.display_name || call.peer.username}</h2><p>{call.phase === 'connected' ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : call.phase === 'incoming' ? `Incoming ${call.type} call` : call.phase === 'calling' ? 'Calling…' : 'Connecting…'}</p></div>{call.type === 'video' && <div className="call-video"><video ref={remoteVideo} autoPlay playsInline /><video ref={localVideo} autoPlay playsInline muted /></div>}{call.type === 'audio' && <audio ref={remoteAudio} autoPlay />}{call.phase === 'incoming' ? <div className="call-controls"><button className="answer" onClick={() => void accept()}><Phone size={20} /> Answer</button><button className="hangup" onClick={reject}><PhoneOff size={20} /> Decline</button></div> : <div className="call-controls"><button onClick={() => { const value = !muted; localStream.current?.getAudioTracks().forEach(track => { track.enabled = !value }); setMuted(value) }} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>{muted ? <MicOff /> : <Mic />}</button>{call.type === 'video' && <button onClick={() => { const value = !cameraOff; localStream.current?.getVideoTracks().forEach(track => { track.enabled = !value }); setCameraOff(value) }} aria-label={cameraOff ? 'Enable camera' : 'Disable camera'}>{cameraOff ? <VideoOff /> : <Video />}</button>}<button className="hangup" onClick={() => end(true)} aria-label="End call"><PhoneOff /></button></div>}</div></div>}</Context.Provider>
}
