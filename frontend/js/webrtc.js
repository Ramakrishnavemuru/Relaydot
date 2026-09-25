// WebRTC PeerConnection Client with Hardware Fallbacks
class WebRTCClient {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
    this.currentFacingMode = 'user';
    this.syntheticAnimationTimer = null;
    this.isSynthetic = false;
    this.onRemoteStreamCallback = null;
    this.onIceCandidateCallback = null;
    this.onConnectionStateChangeCallback = null;
  }

  // Load dynamic ICE servers from backend
  async initConfig() {
    try {
      const data = await API.get('/calls/config');
      if (data && data.ice_servers) {
        this.iceServers = data.ice_servers;
      }
    } catch (e) {
      console.warn('[WebRTC] Using fallback STUN servers:', e);
    }
  }

  // Acquire camera / microphone with resilient hardware fallbacks
  async getMediaStream(callType = 'video') {
    const isVideo = callType === 'video';
    this.isSynthetic = false;

    // Check secure context
    if (window.isSecureContext === false) {
      console.warn('[WebRTC] Insecure origin: WebRTC getUserMedia requires HTTPS or localhost');
      Utils.showToast('Note: Camera/mic access requires HTTPS or localhost', 'warning');
    }

    // 1. Try progressive real hardware constraints
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        // Attempt 1: Full ideal constraints
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true
          },
          video: isVideo ? { facingMode: this.currentFacingMode } : false
        });
        return this.localStream;
      } catch (err1) {
        console.warn('[WebRTC] Attempt 1 failed:', err1.name, err1.message);

        // Attempt 2: Simplified constraints
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: isVideo ? true : false
          });
          return this.localStream;
        } catch (err2) {
          console.warn('[WebRTC] Attempt 2 failed:', err2.name, err2.message);

          // Attempt 3: If video failed (e.g. no camera attached or camera in use), try audio only + synthetic video track
          if (isVideo) {
            try {
              const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
              const syntheticVideo = this.createSyntheticVideoTrack();
              audioStream.addTrack(syntheticVideo);
              this.localStream = audioStream;
              Utils.showToast('Camera unavailable. Using virtual video stream with real microphone.', 'info');
              return this.localStream;
            } catch (err3) {
              console.warn('[WebRTC] Audio-only fallback also failed:', err3.name, err3.message);
            }
          }
        }
      }
    }

    // 2. Hardware completely unavailable, denied, or insecure context:
    // Create a virtual synthetic stream (canvas animation + silent audio)
    // This allows calls to always work and be tested seamlessly between tabs
    console.info('[WebRTC] Falling back to synthetic virtual stream for call');
    this.isSynthetic = true;

    const syntheticStream = new MediaStream();
    const audioTrack = this.createSyntheticAudioTrack();
    syntheticStream.addTrack(audioTrack);

    if (isVideo) {
      const videoTrack = this.createSyntheticVideoTrack();
      syntheticStream.addTrack(videoTrack);
    }

    this.localStream = syntheticStream;
    Utils.showToast('Using virtual audio/video stream (Camera/Mic not detected or blocked).', 'info', 5000);
    return this.localStream;
  }

  // Create an animated canvas video track (shows avatar and name)
  createSyntheticVideoTrack() {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    const currentUser = (window.Auth && Auth.getCurrentUser()) || { display_name: 'You', username: 'you' };
    const name = currentUser.display_name || currentUser.username;
    let wave = 0;

    const drawFrame = () => {
      wave += 0.05;

      // Dark background gradient
      const grad = ctx.createLinearGradient(0, 0, 640, 480);
      grad.addColorStop(0, '#1e1b4b');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 480);

      // Pulsing outer ripple
      const radius = 80 + Math.sin(wave) * 10;
      ctx.beginPath();
      ctx.arc(320, 210, radius + 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
      ctx.fill();

      // Avatar circle
      ctx.beginPath();
      ctx.arc(320, 210, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#4f46e5';
      ctx.fill();

      // Avatar Initial Letter
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 54px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name.charAt(0).toUpperCase(), 320, 210);

      // User name label
      ctx.font = '600 24px sans-serif';
      ctx.fillText(name, 320, 340);

      // Status text
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Virtual Video Stream', 320, 375);
    };

    drawFrame();
    this.syntheticAnimationTimer = setInterval(drawFrame, 100);

    const stream = canvas.captureStream ? canvas.captureStream(20) : null;
    if (stream && stream.getVideoTracks().length > 0) {
      return stream.getVideoTracks()[0];
    }

    // Fallback blank track if captureStream unsupported
    const blankCanvas = document.createElement('canvas');
    blankCanvas.width = 1;
    blankCanvas.height = 1;
    return blankCanvas.captureStream().getVideoTracks()[0];
  }

  // Create a silent audio track using Web Audio API
  createSyntheticAudioTrack() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const dst = ctx.createMediaStreamDestination();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001; // Silent tone to keep stream alive
      osc.connect(gain);
      gain.connect(dst);
      osc.start();
      return dst.stream.getAudioTracks()[0];
    } catch (e) {
      console.warn('[WebRTC] Could not create Web Audio destination:', e);
      return null;
    }
  }

  // Initialize RTCPeerConnection
  createPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    this.remoteStream = new MediaStream();

    // Add local tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle incoming remote media tracks
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Received remote track:', event.track.kind);
      event.streams[0].getTracks().forEach(track => {
        this.remoteStream.addTrack(track);
      });
      if (this.onRemoteStreamCallback) {
        this.onRemoteStreamCallback(this.remoteStream);
      }
    };

    // Handle local ICE candidates to be sent over WebSocket signaling
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidateCallback) {
        this.onIceCandidateCallback(event.candidate);
      }
    };

    // Connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('[WebRTC] Connection state changed:', state);
      if (this.onConnectionStateChangeCallback) {
        this.onConnectionStateChangeCallback(state);
      }
    };

    return this.peerConnection;
  }

  // Caller: Create and send SDP Offer
  async createOffer() {
    if (!this.peerConnection) this.createPeerConnection();
    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  // Callee: Receive Offer & Create Answer
  async handleOfferAndCreateAnswer(offerSdp) {
    if (!this.peerConnection) this.createPeerConnection();
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  // Caller: Receive Answer
  async handleAnswer(answerSdp) {
    if (this.peerConnection) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
    }
  }

  // Add remote ICE candidate
  async addIceCandidate(candidateInit) {
    if (this.peerConnection && candidateInit) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch (err) {
        console.warn('[WebRTC] Error adding ICE candidate:', err);
      }
    }
  }

  // Toggle Microphone
  toggleAudio(enabled) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  // Toggle Camera
  toggleVideo(enabled) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  // Switch Camera (Mobile: front vs back camera)
  async switchCamera() {
    if (this.isSynthetic) {
      Utils.showToast('Using virtual camera in preview mode', 'info');
      return;
    }
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.currentFacingMode }
      });
      const newVideoTrack = newStream.getVideoTracks()[0];

      // Replace track on sender
      if (this.peerConnection) {
        const senders = this.peerConnection.getSenders();
        const sender = senders.find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
        }
      }

      // Update local stream
      videoTrack.stop();
      this.localStream.removeTrack(videoTrack);
      this.localStream.addTrack(newVideoTrack);
      return newVideoTrack;
    } catch (e) {
      console.warn('[WebRTC] Camera switch failed:', e);
    }
  }

  // Teardown and release hardware & synthetic timers
  cleanup() {
    if (this.syntheticAnimationTimer) {
      clearInterval(this.syntheticAnimationTimer);
      this.syntheticAnimationTimer = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.remoteStream = null;
    this.isSynthetic = false;
  }
}

const webrtc = new WebRTCClient();
