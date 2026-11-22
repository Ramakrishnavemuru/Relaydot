import { readPreference, writePreference } from './storage'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Mic, MicOff, Phone, PhoneOff, RotateCw, Video, VideoOff, Volume2, X } from 'lucide-react'
import { api } from './api'
import { Avatar } from './components'
import type { User } from './types'

type CallPhase = 'incoming' | 'calling' | 'connecting' | 'connected' | 'reconnecting'
type Call = { id: string; peer: User; type: 'audio' | 'video'; phase: CallPhase; caller: boolean }
type Signal = { event: string; data?: Record<string, unknown> }
type CallConfig = { ice_servers: RTCIceServer[]; ice_transport_policy: RTCIceTransportPolicy; turn_expires_at: number | null }
type CallContextValue = { startCall: (peer: User, type: 'audio' | 'video') => Promise<void> }
const Context = createContext<CallContextValue | null>(null)
export const useCall = () => { const value = useContext(Context); if (!value) throw new Error('Call provider missing'); return value }
const send = (event: string, data: object) => window.dispatchEvent(new CustomEvent('relay-send-signal', { detail: { event, data } }))
const errorMessage = (cause: unknown, type: 'audio' | 'video') => {
  if (cause instanceof DOMException) {
    if (cause.name === 'NotAllowedError' || cause.name === 'PermissionDeniedError') return `${type === 'video' ? 'Camera or microphone' : 'Microphone'} access was denied. Allow it in browser settings and try again.`
    if (cause.name === 'NotFoundError') return `No ${type === 'video' ? 'camera or microphone' : 'microphone'} was found.`
    if (cause.name === 'NotReadableError') return 'Your camera or microphone is already in use by another app.'
  }
  return cause instanceof Error ? cause.message : 'The call could not be started.'
}

export function CallProvider({ children }: { children: ReactNode }) {
  const [call, setCall] = useState<Call | null>(null)
  const active = useRef<Call | null>(null)
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [playbackBlocked, setPlaybackBlocked] = useState(false)
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([])
  const [speakerId, setSpeakerId] = useState(() => readPreference('relay-speaker-device'))
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [diagnostics, setDiagnostics] = useState('')
  const [configRevision, setConfigRevision] = useState(0)
  const localStream = useRef<MediaStream | null>(null)
  const remoteStream = useRef<MediaStream | null>(null)
  const connection = useRef<RTCPeerConnection | null>(null)
  const pendingIce = useRef<RTCIceCandidateInit[]>([])
  const config = useRef<CallConfig | null>(null)
  const generation = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localVideo = useRef<HTMLVideoElement | null>(null)
  const remoteVideo = useRef<HTMLVideoElement | null>(null)
  const remoteAudio = useRef<HTMLAudioElement | null>(null)
  const update = (value: Call | null) => { active.current = value; setCall(value) }
  const same = (id: string, epoch: number) => active.current?.id === id && generation.current === epoch
  const end = useCallback((notify = true) => {
    const current = active.current
    active.current = null
    generation.current += 1
    if (retryTimer.current) clearTimeout(retryTimer.current)
    retryTimer.current = null
    if (current && notify) send('call_end', { call_id: current.id, target_user_id: current.peer.id })
    const pc = connection.current
    connection.current = null
    if (pc) { pc.onconnectionstatechange = null; pc.oniceconnectionstatechange = null; pc.ontrack = null; pc.onicecandidate = null; pc.close() }
    localStream.current?.getTracks().forEach(track => track.stop())
    localStream.current = null
    remoteStream.current = null
    pendingIce.current = []
    config.current = null
    if (remoteAudio.current) { remoteAudio.current.pause(); remoteAudio.current.srcObject = null }
    if (remoteVideo.current) { remoteVideo.current.pause(); remoteVideo.current.srcObject = null }
    if (localVideo.current) localVideo.current.srcObject = null
    setCall(null); setMuted(false); setCameraOff(false); setSeconds(0); setPlaybackBlocked(false); setDiagnostics('')
  }, [])
  const loadConfig = useCallback(async () => {
    const result = await api<CallConfig>('/calls/config')
    if (!Array.isArray(result.ice_servers)) throw new Error('Call server configuration is invalid.')
    config.current = result
    setConfigRevision(value => value + 1)
  }, [])
  const refreshSpeakers = useCallback(() => {
    void navigator.mediaDevices.enumerateDevices().then(devices => setSpeakers(devices.filter(device => device.kind === 'audiooutput'))).catch(() => {})
  }, [])
  const playRemote = useCallback(() => {
    const element = active.current?.type === 'video' ? remoteVideo.current : remoteAudio.current
    if (!element || !remoteStream.current?.getTracks().length) return
    element.srcObject = remoteStream.current
    if ('setSinkId' in element && speakerId) void (element as HTMLMediaElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(speakerId).catch(() => {})
    void element.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true))
  }, [speakerId])
  const acquireMedia = useCallback(async (current: Call, epoch: number) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calls require HTTPS or localhost and a supported browser.')
    const mic = readPreference('relay-mic-device')
    const camera = readPreference('relay-camera-device')
    const connectionHint = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType
    const lowBandwidth = connectionHint === '2g' || connectionHint === '3g'
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        ...(mic ? { deviceId: { ideal: mic } } : {}) },
      video: current.type === 'video' ? { width: { ideal: lowBandwidth ? 640 : 1280 },
        height: { ideal: lowBandwidth ? 360 : 720 }, frameRate: { ideal: lowBandwidth ? 15 : 24, max: 30 },
        ...(camera ? { deviceId: { ideal: camera } } : { facingMode: { ideal: 'user' } }) } : false,
    })
    if (!same(current.id, epoch)) { stream.getTracks().forEach(track => track.stop()); return false }
    localStream.current = stream
    if (localVideo.current) localVideo.current.srcObject = stream
    refreshSpeakers()
    return true
  }, [refreshSpeakers])
  const recoverMic = useCallback(async (id: string, epoch: number) => {
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!same(id, epoch)) { replacement.getTracks().forEach(track => track.stop()); return }
      const track = replacement.getAudioTracks()[0]
      const sender = connection.current?.getSenders().find(item => item.track?.kind === 'audio')
      if (sender) await sender.replaceTrack(track)
      if (!same(id, epoch)) { track.stop(); return }
      localStream.current?.getAudioTracks().forEach(old => { localStream.current?.removeTrack(old); old.stop() })
      localStream.current?.addTrack(track)
      track.onended = () => { if (same(id, epoch)) void recoverMic(id, epoch) }
      setMuted(false)
    } catch { if (same(id, epoch)) setError('Microphone disconnected. Check its permission and reconnect the device.') }
  }, [])
  const flushIce = async (pc: RTCPeerConnection) => {
    for (const candidate of pendingIce.current.splice(0)) await pc.addIceCandidate(candidate)
  }
  const offer = useCallback(async (id: string, epoch: number, restart = false) => {
    const pc = connection.current
    const current = active.current
    if (!pc || !current?.caller || !same(id, epoch) || pc.signalingState !== 'stable') return
    if (restart) pc.restartIce()
    const description = await pc.createOffer(restart ? { iceRestart: true } : undefined)
    if (!same(id, epoch)) return
    await pc.setLocalDescription(description)
    if (same(id, epoch)) send('webrtc_offer', { call_id: id, target_user_id: current.peer.id, offer: pc.localDescription?.toJSON() })
  }, [])
  const makeConnection = useCallback((current: Call, epoch: number) => {
    if (connection.current) return connection.current
    if (!config.current) throw new Error('Call server configuration is unavailable.')
    const pc = new RTCPeerConnection({ iceServers: config.current.ice_servers,
      iceTransportPolicy: config.current.ice_transport_policy })
    connection.current = pc
    const remote = new MediaStream()
    remoteStream.current = remote
    pc.ontrack = event => {
      if (!same(current.id, epoch)) return
      if (!remote.getTracks().some(track => track.id === event.track.id)) remote.addTrack(event.track)
      playRemote()
    }
    pc.onicecandidate = event => {
      if (event.candidate && same(current.id, epoch)) send('ice_candidate', {
        call_id: current.id, target_user_id: current.peer.id, candidate: event.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      if (!same(current.id, epoch)) return
      if (pc.connectionState === 'connected') {
        if (retryTimer.current) clearTimeout(retryTimer.current)
        retryTimer.current = null
        update({ ...active.current!, phase: 'connected' })
        playRemote()
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (active.current?.phase !== 'reconnecting') update({ ...active.current!, phase: 'reconnecting' })
        if (current.caller && pc.signalingState === 'stable') void offer(current.id, epoch, true).catch(() => {})
        if (!retryTimer.current) retryTimer.current = setTimeout(() => {
          if (same(current.id, epoch) && pc.connectionState !== 'connected') {
            end(true); setError('The connection could not recover. Check your network or TURN server.')
          }
        }, 25_000)
      } else if (pc.connectionState === 'closed' && same(current.id, epoch)) end(false)
    }
    localStream.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStream.current!)
      if (track.kind === 'audio') track.onended = () => { if (same(current.id, epoch)) void recoverMic(current.id, epoch) }
      if (track.kind === 'video') track.onended = () => { if (same(current.id, epoch)) { setCameraOff(true); setError('Camera disconnected. Try switching the camera.') } }
    })
    return pc
  }, [end, offer, playRemote, recoverMic])
  const startCall = useCallback(async (peer: User, type: 'audio' | 'video') => {
    if (active.current) return
    setError('')
    const current: Call = { id: crypto.randomUUID(), peer, type, phase: 'calling', caller: true }
    const epoch = ++generation.current
    update(current)
    try {
      await loadConfig()
      if (!same(current.id, epoch)) return
      if (await acquireMedia(current, epoch)) send('call_invite', { call_id: current.id, target_user_id: peer.id, call_type: type })
    } catch (cause) { if (same(current.id, epoch)) { end(false); setError(errorMessage(cause, type)) } }
  }, [loadConfig, acquireMedia, end])
  const accept = useCallback(async () => {
    const current = active.current
    if (!current || current.phase !== 'incoming') return
    const epoch = generation.current
    update({ ...current, phase: 'connecting' })
    try {
      await loadConfig()
      if (!same(current.id, epoch)) return
      if (!(await acquireMedia(current, epoch))) return
      makeConnection(current, epoch)
      send('call_accept', { call_id: current.id, target_user_id: current.peer.id })
    } catch (cause) {
      if (same(current.id, epoch)) {
        send('call_reject', { call_id: current.id, target_user_id: current.peer.id, reason: 'unavailable' })
        end(false); setError(errorMessage(cause, current.type))
      }
    }
  }, [loadConfig, acquireMedia, makeConnection, end])
  const reject = () => {
    const current = active.current
    if (current) send('call_reject', { call_id: current.id, target_user_id: current.peer.id, reason: 'declined' })
    end(false)
  }
  const switchCamera = useCallback(async () => {
    const current = active.current
    if (!current || current.type !== 'video') return
    const epoch = generation.current
    const next = facing === 'user' ? 'environment' : 'user'
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: {
        facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } })
      const track = stream.getVideoTracks()[0]
      if (!same(current.id, epoch)) { track.stop(); return }
      const sender = connection.current?.getSenders().find(item => item.track?.kind === 'video')
      if (sender) await sender.replaceTrack(track)
      if (!same(current.id, epoch)) { track.stop(); return }
      localStream.current?.getVideoTracks().forEach(old => { localStream.current?.removeTrack(old); old.stop() })
      localStream.current?.addTrack(track)
      if (localVideo.current) localVideo.current.srcObject = localStream.current
      track.onended = () => { if (same(current.id, epoch)) setCameraOff(true) }
      setFacing(next); setCameraOff(false)
    } catch (cause) { if (same(current.id, epoch)) setError(errorMessage(cause, 'video')) }
  }, [facing])
  useEffect(() => {
    const onSignal = (event: Event) => {
      const { event: kind, data = {} } = (event as CustomEvent<Signal>).detail
      const id = typeof data.call_id === 'string' ? data.call_id : ''
      const current = active.current
      if (kind === 'call_invite') {
        const callerId = Number(data.caller_id)
        if (!id || !Number.isInteger(callerId)) return
        if (current || document.documentElement.dataset.callNotifications === 'false') {
          send('call_reject', { call_id: id, target_user_id: callerId, reason: current ? 'busy' : 'unavailable' })
          return
        }
        generation.current += 1
        update({ id, peer: { id: callerId, username: String(data.caller_name || 'Contact'),
          display_name: String(data.caller_name || 'Contact'),
          avatar_url: typeof data.caller_avatar === 'string' ? data.caller_avatar : null },
          type: data.call_type === 'video' ? 'video' : 'audio', phase: 'incoming', caller: false })
        return
      }
      if (!current || current.id !== id) return
      if (kind === 'call_error') { end(false); setError(String(data.message || 'Call signaling failed.')); return }
      if (kind === 'call_reject' || kind === 'call_end') {
        end(false)
        if (kind === 'call_reject') setError(data.reason === 'busy' ? 'This contact is busy.' : 'Call declined or unavailable.')
        else if (data.reason === 'disconnected') setError('The other caller disconnected.')
        return
      }
      if (kind === 'call_accept' && data.accepted_elsewhere === true && current.phase === 'incoming') { end(false); return }
      if (Number(data.sender_id) !== current.peer.id) return
      const epoch = generation.current
      void (async () => {
        try {
          if (kind === 'call_accept' && current.caller && current.phase === 'calling') {
            update({ ...current, phase: 'connecting' })
            makeConnection(current, epoch)
            await offer(id, epoch)
          } else if (kind === 'webrtc_offer' && !current.caller && connection.current) {
            const pc = connection.current
            if (pc.signalingState !== 'stable') return
            await pc.setRemoteDescription(data.offer as RTCSessionDescriptionInit)
            if (!same(id, epoch)) return
            await flushIce(pc)
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            if (same(id, epoch)) send('webrtc_answer', { call_id: id, target_user_id: current.peer.id, answer: pc.localDescription?.toJSON() })
          } else if (kind === 'webrtc_answer' && current.caller && connection.current) {
            const pc = connection.current
            if (pc.signalingState !== 'have-local-offer') return
            await pc.setRemoteDescription(data.answer as RTCSessionDescriptionInit)
            if (same(id, epoch)) await flushIce(pc)
          } else if (kind === 'ice_candidate' && data.candidate) {
            const candidate = data.candidate as RTCIceCandidateInit
            if (connection.current?.remoteDescription) await connection.current.addIceCandidate(candidate)
            else pendingIce.current.push(candidate)
          }
        } catch (cause) { if (same(id, epoch)) { end(true); setError(errorMessage(cause, current.type)) } }
      })()
    }
    const onSocket = (event: Event) => {
      if ((event as CustomEvent<{ open: boolean }>).detail.open === false && active.current) {
        end(false); setError('Signaling disconnected. Check your network and try again.')
      }
    }
    window.addEventListener('relay-call', onSignal)
    window.addEventListener('relay-socket-status', onSocket)
    return () => { window.removeEventListener('relay-call', onSignal); window.removeEventListener('relay-socket-status', onSocket) }
  }, [end, makeConnection, offer])
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = localStream.current; playRemote() }, [call?.phase, call?.type, playRemote])
  useEffect(() => {
    const expiry = config.current?.turn_expires_at
    if (!call || !connection.current || !expiry || call.phase === 'incoming' || call.phase === 'calling') return
    const id = call.id, epoch = generation.current
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await loadConfig()
          if (!same(id, epoch) || !connection.current || !config.current) return
          connection.current.setConfiguration({ ...connection.current.getConfiguration(),
            iceServers: config.current.ice_servers, iceTransportPolicy: config.current.ice_transport_policy })
          if (active.current?.caller && connection.current.signalingState === 'stable') await offer(id, epoch, true)
        } catch { if (same(id, epoch)) setError('TURN credentials could not be refreshed. The call may disconnect; check your network.') }
      })()
    }, Math.max(1000, expiry * 1000 - Date.now() - 120_000))
    return () => clearTimeout(timer)
  }, [call?.id, call?.phase, configRevision, loadConfig, offer])
  useEffect(() => {
    if (!call || call.phase === 'connected') return
    const id = call.id
    const phase = call.phase
    const timeout = setTimeout(() => {
      if (active.current?.id === id && active.current.phase === phase) {
        end(true); setError(phase === 'incoming' ? 'Missed call.' : 'Call timed out. Check your connection and TURN configuration.')
      }
    }, phase === 'incoming' || phase === 'calling' ? 45_000 : phase === 'connecting' ? 65_000 : 25_000)
    return () => clearTimeout(timeout)
  }, [call?.id, call?.phase, end])
  useEffect(() => { if (call?.phase !== 'connected') return; const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer) }, [call?.phase])
  useEffect(() => {
    if (call?.phase !== 'incoming' || document.documentElement.dataset.callRingtone === 'false') return
    let context: AudioContext | null = null
    const play = () => {
      try {
        context ??= new AudioContext()
        const tone = context.createOscillator()
        const volume = context.createGain()
        tone.frequency.value = 620; volume.gain.value = .035
        tone.connect(volume).connect(context.destination); tone.start(); tone.stop(context.currentTime + .16)
      } catch { /* Audio can require a user gesture. */ }
    }
    play(); const timer = setInterval(play, 2200)
    return () => { clearInterval(timer); void context?.close() }
  }, [call?.phase])
  useEffect(() => {
    if (!import.meta.env.DEV || !call || call.phase === 'incoming') return
    let previousBytes = 0
    const sample = async () => {
      const pc = connection.current
      if (!pc) { setDiagnostics('Waiting for peer connection'); return }
      const stats = await pc.getStats()
      let path = 'Selecting route', loss = 0, received = 0, bitrate = 0, rtt = 0
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
          const local = stats.get(report.localCandidateId)
          const remote = stats.get(report.remoteCandidateId)
          path = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'TURN relay' : 'Direct P2P'
          rtt = report.currentRoundTripTime || 0
        }
        if (report.type === 'inbound-rtp' && !report.isRemote) { loss += report.packetsLost || 0; received += report.packetsReceived || 0 }
        if (report.type === 'outbound-rtp' && !report.isRemote) bitrate += report.bytesSent || 0
      })
      const kbps = previousBytes ? Math.max(0, Math.round((bitrate - previousBytes) * 8 / 2000)) : 0
      previousBytes = bitrate
      setDiagnostics(`Socket open · SDP ${pc.remoteDescription ? 'received' : 'pending'} · ICE ${pc.iceGatheringState}/${pc.iceConnectionState} · Peer ${pc.connectionState} · Local ${localStream.current?.getTracks().filter(track => track.readyState === 'live').length || 0} · Remote ${remoteStream.current?.getTracks().filter(track => track.readyState === 'live').length || 0} · ${path} · Loss ${loss}/${loss + received} · RTT ${Math.round(rtt * 1000)} ms · Upload ${kbps} kbps`)
    }
    void sample().catch(() => {})
    const timer = setInterval(() => void sample().catch(() => {}), 2000)
    return () => clearInterval(timer)
  }, [call?.id, call?.phase])
  useEffect(() => () => end(false), [end])
  return <Context.Provider value={{ startCall }}>{children}
    {error && <div className="call-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {call && <div className="call-backdrop"><div className="call-card" role="dialog" aria-modal="true" aria-label={`${call.type} call`}>
      <div className="call-head"><Avatar user={call.peer} size="lg" /><h2>{call.peer.display_name || call.peer.username}</h2><p>{call.phase === 'connected' ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : call.phase === 'incoming' ? `Incoming ${call.type} call` : call.phase === 'calling' ? 'Calling…' : call.phase === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</p></div>
      {call.type === 'video' && <div className="call-video"><video ref={remoteVideo} autoPlay playsInline /><video ref={localVideo} autoPlay playsInline muted /></div>}
      {call.type === 'audio' && <audio ref={remoteAudio} autoPlay />}
      {playbackBlocked && <button className="button secondary call-playback" onClick={playRemote}><Volume2 size={16} /> Tap to play call audio</button>}
      {call.phase === 'incoming' ? <div className="call-controls"><button className="answer" onClick={() => void accept()}><Phone size={20} /> Answer</button><button className="hangup" onClick={reject}><PhoneOff size={20} /> Decline</button></div> : <>
        {speakers.length > 1 && <label className="call-speaker">Speaker<select aria-label="Speaker" value={speakerId} onChange={event => { setSpeakerId(event.target.value); writePreference('relay-speaker-device', event.target.value) }}><option value="">System default</option>{speakers.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Speaker'}</option>)}</select></label>}
        <div className="call-controls"><button onClick={() => { const next = !muted; const tracks = localStream.current?.getAudioTracks() || []; if (tracks.some(track => track.readyState === 'ended')) void recoverMic(call.id, generation.current); else { tracks.forEach(track => { track.enabled = !next }); setMuted(next) } }} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>{muted ? <MicOff /> : <Mic />}</button>
          {call.type === 'video' && <><button onClick={() => { const next = !cameraOff; const tracks = localStream.current?.getVideoTracks() || []; if (!tracks.length || tracks.some(track => track.readyState === 'ended')) void switchCamera(); else { tracks.forEach(track => { track.enabled = !next }); setCameraOff(next) } }} aria-label={cameraOff ? 'Enable camera' : 'Disable camera'}>{cameraOff ? <VideoOff /> : <Video />}</button><button onClick={() => void switchCamera()} aria-label="Switch camera"><RotateCw /></button></>}
          <button className="hangup" onClick={() => end(true)} aria-label="End call"><PhoneOff /></button></div></>}
      {import.meta.env.DEV && <details className="call-diagnostics"><summary>Connection diagnostics</summary><p>{diagnostics || 'Waiting for media and signaling'}</p></details>}
    </div></div>}
  </Context.Provider>
}
