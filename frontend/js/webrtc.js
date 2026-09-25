// WebRTC PeerConnection Client
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

  // Acquire camera / microphone
  async getMediaStream(callType = 'video') {
    const isVideo = callType === 'video';
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: isVideo ? {
        facingMode: this.currentFacingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      } : false
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.localStream;
    } catch (err) {
      console.error('[WebRTC] getUserMedia failed:', err);
      throw new Error('Could not access microphone or camera. Please check browser permissions.');
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

  // Teardown and release hardware
  cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.remoteStream = null;
  }
}

const webrtc = new WebRTCClient();
