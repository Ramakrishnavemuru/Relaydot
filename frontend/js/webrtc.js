// WebRTC PeerConnection Client
// Handles:
// - Camera / microphone
// - Voice calls
// - Video calls
// - ICE candidate queuing
// - STUN / TURN configuration
// - Connection diagnostics
// - Hardware fallbacks

class WebRTCClient {
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;

    // Default STUN servers.
    // Backend /calls/config can replace these with STUN + TURN.
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];

    this.currentFacingMode = 'user';

    this.syntheticAnimationTimer = null;
    this.syntheticAudioContext = null;

    this.isSynthetic = false;

    // IMPORTANT:
    // ICE candidates can arrive before the PeerConnection
    // or before remoteDescription is available.
    this.pendingIceCandidates = [];

    this.onRemoteStreamCallback = null;
    this.onIceCandidateCallback = null;
    this.onConnectionStateChangeCallback = null;
    this.onIceConnectionStateChangeCallback = null;

    console.log('[WebRTC] Client initialized');
  }

  // ============================================================
  // LOAD ICE CONFIGURATION FROM BACKEND
  // ============================================================

  async initConfig() {
    try {
      console.log('[WebRTC] Loading ICE configuration...');

      const data = await API.get('/calls/config');

      if (
        data &&
        Array.isArray(data.ice_servers) &&
        data.ice_servers.length > 0
      ) {
        this.iceServers = data.ice_servers;

        console.log(
          '[WebRTC] ICE servers loaded:',
          this.iceServers.map(server => server.urls)
        );
      } else {
        console.warn(
          '[WebRTC] Backend returned no ICE servers. Using fallback STUN.'
        );
      }
    } catch (error) {
      console.warn(
        '[WebRTC] Could not load ICE config. Using fallback STUN.',
        error
      );
    }
  }

  // ============================================================
  // GET CAMERA / MICROPHONE
  // ============================================================

  async getMediaStream(callType = 'video') {
    const isVideo = callType === 'video';

    this.isSynthetic = false;

    console.log(
      `[WebRTC] Requesting ${isVideo ? 'camera + microphone' : 'microphone'}`
    );

    // WebRTC camera/mic requires HTTPS or localhost.
    if (window.isSecureContext === false) {
      console.warn(
        '[WebRTC] Insecure context. Camera/microphone requires HTTPS or localhost.'
      );

      Utils.showToast(
        'Camera/mic access requires HTTPS or localhost.',
        'warning'
      );
    }

    if (
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
    ) {
      // --------------------------------------------------------
      // Attempt 1
      // --------------------------------------------------------

      try {
        console.log('[WebRTC] Media attempt 1');

        this.localStream =
          await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },

            video: isVideo
              ? {
                  facingMode: this.currentFacingMode
                }
              : false
          });

        console.log(
          '[WebRTC] Real media acquired successfully'
        );

        this.logStreamTracks(this.localStream);

        return this.localStream;
      } catch (error1) {
        console.warn(
          '[WebRTC] Media attempt 1 failed:',
          error1.name,
          error1.message
        );
      }

      // --------------------------------------------------------
      // Attempt 2
      // --------------------------------------------------------

      try {
        console.log('[WebRTC] Media attempt 2');

        this.localStream =
          await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: isVideo
          });

        console.log(
          '[WebRTC] Simplified media acquired successfully'
        );

        this.logStreamTracks(this.localStream);

        return this.localStream;
      } catch (error2) {
        console.warn(
          '[WebRTC] Media attempt 2 failed:',
          error2.name,
          error2.message
        );
      }

      // --------------------------------------------------------
      // Attempt 3
      // Video requested but camera failed.
      // Use real microphone + synthetic video.
      // --------------------------------------------------------

      if (isVideo) {
        try {
          console.log(
            '[WebRTC] Trying microphone + synthetic video'
          );

          const audioStream =
            await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              },
              video: false
            });

          const syntheticVideo =
            this.createSyntheticVideoTrack();

          if (syntheticVideo) {
            audioStream.addTrack(syntheticVideo);
          }

          this.localStream = audioStream;

          Utils.showToast(
            'Camera unavailable. Using virtual video with real microphone.',
            'info'
          );

          this.logStreamTracks(this.localStream);

          return this.localStream;
        } catch (error3) {
          console.warn(
            '[WebRTC] Audio-only fallback failed:',
            error3.name,
            error3.message
          );
        }
      }
    }

    // ============================================================
    // COMPLETE SYNTHETIC FALLBACK
    // ============================================================

    console.warn(
      '[WebRTC] Hardware unavailable. Using synthetic media.'
    );

    this.isSynthetic = true;

    const syntheticStream = new MediaStream();

    const syntheticAudio =
      this.createSyntheticAudioTrack();

    if (syntheticAudio) {
      syntheticStream.addTrack(syntheticAudio);
    }

    if (isVideo) {
      const syntheticVideo =
        this.createSyntheticVideoTrack();

      if (syntheticVideo) {
        syntheticStream.addTrack(syntheticVideo);
      }
    }

    this.localStream = syntheticStream;

    Utils.showToast(
      'Using virtual audio/video because camera or microphone is unavailable.',
      'info',
      5000
    );

    this.logStreamTracks(this.localStream);

    return this.localStream;
  }

  // ============================================================
  // LOG MEDIA TRACKS
  // ============================================================

  logStreamTracks(stream) {
    if (!stream) {
      console.warn('[WebRTC] No media stream');
      return;
    }

    console.log(
      '[WebRTC] Local audio tracks:',
      stream.getAudioTracks().map(track => ({
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState
      }))
    );

    console.log(
      '[WebRTC] Local video tracks:',
      stream.getVideoTracks().map(track => ({
        id: track.id,
        enabled: track.enabled,
        readyState: track.readyState
      }))
    );
  }

  // ============================================================
  // SYNTHETIC VIDEO
  // ============================================================

  createSyntheticVideoTrack() {
    const canvas = document.createElement('canvas');

    canvas.width = 640;
    canvas.height = 480;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.warn(
        '[WebRTC] Canvas context unavailable'
      );
      return null;
    }

    const currentUser =
      typeof Auth !== 'undefined' &&
      Auth.getCurrentUser
        ? Auth.getCurrentUser()
        : {
            display_name: 'You',
            username: 'you'
          };

    const name =
      currentUser?.display_name ||
      currentUser?.username ||
      'You';

    let wave = 0;

    const drawFrame = () => {
      wave += 0.05;

      // Background
      const gradient =
        ctx.createLinearGradient(
          0,
          0,
          640,
          480
        );

      gradient.addColorStop(
        0,
        '#1e1b4b'
      );

      gradient.addColorStop(
        1,
        '#0f172a'
      );

      ctx.fillStyle = gradient;

      ctx.fillRect(
        0,
        0,
        640,
        480
      );

      // Ripple
      const radius =
        80 + Math.sin(wave) * 10;

      ctx.beginPath();

      ctx.arc(
        320,
        210,
        radius + 20,
        0,
        Math.PI * 2
      );

      ctx.fillStyle =
        'rgba(99, 102, 241, 0.2)';

      ctx.fill();

      // Avatar
      ctx.beginPath();

      ctx.arc(
        320,
        210,
        radius,
        0,
        Math.PI * 2
      );

      ctx.fillStyle =
        '#4f46e5';

      ctx.fill();

      // Initial
      ctx.fillStyle =
        '#ffffff';

      ctx.font =
        'bold 54px sans-serif';

      ctx.textAlign =
        'center';

      ctx.textBaseline =
        'middle';

      ctx.fillText(
        name.charAt(0).toUpperCase(),
        320,
        210
      );

      // Name
      ctx.font =
        '600 24px sans-serif';

      ctx.fillText(
        name,
        320,
        340
      );

      // Status
      ctx.font =
        '14px sans-serif';

      ctx.fillStyle =
        '#94a3b8';

      ctx.fillText(
        'Virtual Video Stream',
        320,
        375
      );
    };

    drawFrame();

    this.syntheticAnimationTimer =
      setInterval(
        drawFrame,
        100
      );

    // Browser supports canvas.captureStream
    if (canvas.captureStream) {
      const stream =
        canvas.captureStream(20);

      if (
        stream &&
        stream.getVideoTracks().length > 0
      ) {
        return stream.getVideoTracks()[0];
      }
    }

    // Fallback
    try {
      const blankCanvas =
        document.createElement('canvas');

      blankCanvas.width = 1;
      blankCanvas.height = 1;

      return blankCanvas
        .captureStream()
        .getVideoTracks()[0];
    } catch (error) {
      console.warn(
        '[WebRTC] Could not create fallback video track:',
        error
      );

      return null;
    }
  }

  // ============================================================
  // SYNTHETIC AUDIO
  // ============================================================

  createSyntheticAudioTrack() {
    try {
      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioContext) {
        console.warn(
          '[WebRTC] Web Audio API unavailable'
        );

        return null;
      }

      const ctx =
        new AudioContext();

      this.syntheticAudioContext = ctx;

      const oscillator =
        ctx.createOscillator();

      const destination =
        ctx.createMediaStreamDestination();

      const gain =
        ctx.createGain();

      // Very quiet signal to keep track alive.
      gain.gain.value = 0.0001;

      oscillator.connect(gain);

      gain.connect(destination);

      oscillator.start();

      const track =
        destination.stream.getAudioTracks()[0];

      return track || null;
    } catch (error) {
      console.warn(
        '[WebRTC] Could not create synthetic audio:',
        error
      );

      return null;
    }
  }

  // ============================================================
  // CREATE PEER CONNECTION
  // ============================================================

  createPeerConnection() {
    console.log(
      '[WebRTC] Creating RTCPeerConnection'
    );

    console.log(
      '[WebRTC] Using ICE servers:',
      this.iceServers
    );

    // Close previous connection if one exists.
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (error) {
        console.warn(
          '[WebRTC] Error closing old connection:',
          error
        );
      }

      this.peerConnection = null;
    }

    this.peerConnection =
      new RTCPeerConnection({
        iceServers: this.iceServers,

        // Help ICE discover candidates quickly.
        iceCandidatePoolSize: 10
      });

    this.remoteStream =
      new MediaStream();

    // IMPORTANT:
    // DO NOT clear pendingIceCandidates here.
    //
    // Candidates may have arrived before this
    // PeerConnection was created.
    //
    // They must remain queued.

    // ==========================================================
    // ADD LOCAL TRACKS
    // ==========================================================

    if (this.localStream) {
      const tracks =
        this.localStream.getTracks();

      console.log(
        '[WebRTC] Adding local tracks:',
        tracks.map(track => track.kind)
      );

      tracks.forEach(track => {
        try {
          this.peerConnection.addTrack(
            track,
            this.localStream
          );
        } catch (error) {
          console.error(
            '[WebRTC] Failed to add local track:',
            error
          );
        }
      });
    }

    // ==========================================================
    // REMOTE TRACK
    // ==========================================================

    this.peerConnection.ontrack =
      (event) => {
        if (!event.track) {
          console.warn(
            '[WebRTC] ontrack event without track'
          );

          return;
        }

        console.log(
          '[WebRTC] Received remote track:',
          event.track.kind,
          event.track.id
        );

        // Add track only if it isn't already present.
        const alreadyExists =
          this.remoteStream
            .getTracks()
            .some(
              track =>
                track.id === event.track.id
            );

        if (!alreadyExists) {
          this.remoteStream.addTrack(
            event.track
          );
        }

        console.log(
          '[WebRTC] Remote tracks now:',
          this.remoteStream
            .getTracks()
            .map(track => track.kind)
        );

        if (
          this.onRemoteStreamCallback
        ) {
          this.onRemoteStreamCallback(
            this.remoteStream
          );
        }
      };

    // ==========================================================
    // LOCAL ICE CANDIDATE
    // ==========================================================

    this.peerConnection.onicecandidate =
      (event) => {
        if (event.candidate) {
          console.log(
            '[WebRTC] Local ICE candidate:',
            event.candidate.candidate
          );

          if (
            this.onIceCandidateCallback
          ) {
            this.onIceCandidateCallback(
              event.candidate
            );
          }
        } else {
          console.log(
            '[WebRTC] ICE candidate gathering complete'
          );
        }
      };

    // ==========================================================
    // ICE GATHERING STATE
    // ==========================================================

    this.peerConnection.onicegatheringstatechange =
      () => {
        const state =
          this.peerConnection.iceGatheringState;

        console.log(
          '[WebRTC] ICE gathering state:',
          state
        );
      };

    // ==========================================================
    // ICE CONNECTION STATE
    // ==========================================================

    this.peerConnection.oniceconnectionstatechange =
      () => {
        const state =
          this.peerConnection.iceConnectionState;

        console.log(
          '[WebRTC] ICE connection state:',
          state
        );

        if (
          this.onIceConnectionStateChangeCallback
        ) {
          this.onIceConnectionStateChangeCallback(
            state
          );
        }

        if (state === 'failed') {
          console.error(
            '[WebRTC] ICE connection FAILED.'
          );

          console.error(
            '[WebRTC] This usually means the peers could not establish a network path.'
          );

          console.error(
            '[WebRTC] A TURN server may be required.'
          );
        }

        if (state === 'disconnected') {
          console.warn(
            '[WebRTC] ICE connection disconnected.'
          );
        }

        if (state === 'connected') {
          console.log(
            '[WebRTC] 🎉 ICE connection established!'
          );
        }

        if (state === 'completed') {
          console.log(
            '[WebRTC] 🎉 ICE connection completed!'
          );
        }
      };

    // ==========================================================
    // PEER CONNECTION STATE
    // ==========================================================

    this.peerConnection.onconnectionstatechange =
      () => {
        const state =
          this.peerConnection.connectionState;

        console.log(
          '[WebRTC] Connection state changed:',
          state
        );

        if (
          this.onConnectionStateChangeCallback
        ) {
          this.onConnectionStateChangeCallback(
            state
          );
        }

        if (state === 'connected') {
          console.log(
            '[WebRTC] 🎉 CALL CONNECTED'
          );
        }

        if (state === 'failed') {
          console.error(
            '[WebRTC] ❌ CALL CONNECTION FAILED'
          );
        }

        if (state === 'disconnected') {
          console.warn(
            '[WebRTC] Call temporarily disconnected'
          );
        }

        if (state === 'closed') {
          console.log(
            '[WebRTC] PeerConnection closed'
          );
        }
      };

    // ==========================================================
    // SIGNALING STATE
    // ==========================================================

    this.peerConnection.onsignalingstatechange =
      () => {
        console.log(
          '[WebRTC] Signaling state:',
          this.peerConnection.signalingState
        );
      };

    // ==========================================================
    // ICE CANDIDATE ERROR
    // ==========================================================

    this.peerConnection.onicecandidateerror =
      (event) => {
        console.error(
          '[WebRTC] ICE candidate error:',
          {
            url: event.url,
            errorCode: event.errorCode,
            errorText: event.errorText
          }
        );
      };

    return this.peerConnection;
  }

  // ============================================================
  // CREATE OFFER
  // ============================================================

  async createOffer() {
    console.log(
      '[WebRTC] Creating offer...'
    );

    if (!this.peerConnection) {
      this.createPeerConnection();
    }

    const offer =
      await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

    console.log(
      '[WebRTC] Offer created'
    );

    await this.peerConnection
      .setLocalDescription(offer);

    console.log(
      '[WebRTC] Local offer description set'
    );

    return this.peerConnection.localDescription;
  }

  // ============================================================
  // HANDLE OFFER AND CREATE ANSWER
  // ============================================================

  async handleOfferAndCreateAnswer(
    offerSdp
  ) {
    console.log(
      '[WebRTC] Received remote offer'
    );

    if (!offerSdp) {
      throw new Error(
        'No WebRTC offer received'
      );
    }

    if (!this.peerConnection) {
      this.createPeerConnection();
    }

    await this.peerConnection
      .setRemoteDescription(
        new RTCSessionDescription(
          offerSdp
        )
      );

    console.log(
      '[WebRTC] Remote offer description set'
    );

    // VERY IMPORTANT:
    // ICE candidates that arrived before
    // remoteDescription was available can
    // now be added.
    await this.flushPendingIceCandidates();

    const answer =
      await this.peerConnection
        .createAnswer();

    console.log(
      '[WebRTC] Answer created'
    );

    await this.peerConnection
      .setLocalDescription(answer);

    console.log(
      '[WebRTC] Local answer description set'
    );

    return this.peerConnection.localDescription;
  }

  // ============================================================
  // HANDLE ANSWER
  // ============================================================

  async handleAnswer(answerSdp) {
    console.log(
      '[WebRTC] Received remote answer'
    );

    if (!answerSdp) {
      throw new Error(
        'No WebRTC answer received'
      );
    }

    if (!this.peerConnection) {
      throw new Error(
        'PeerConnection does not exist while handling answer'
      );
    }

    await this.peerConnection
      .setRemoteDescription(
        new RTCSessionDescription(
          answerSdp
        )
      );

    console.log(
      '[WebRTC] Remote answer description set'
    );

    // Now queued ICE candidates can be added.
    await this.flushPendingIceCandidates();
  }

  // ============================================================
  // ADD REMOTE ICE CANDIDATE
  // ============================================================

  async addIceCandidate(
    candidateInit
  ) {
    if (!candidateInit) {
      return;
    }

    // ----------------------------------------------------------
    // IMPORTANT FIX
    //
    // If PeerConnection doesn't exist yet OR remoteDescription
    // isn't ready, queue the candidate.
    // ----------------------------------------------------------

    if (
      !this.peerConnection ||
      !this.peerConnection.remoteDescription
    ) {
      console.log(
        '[WebRTC] Queueing ICE candidate because PeerConnection/remoteDescription is not ready'
      );

      this.pendingIceCandidates.push(
        candidateInit
      );

      console.log(
        '[WebRTC] Pending ICE candidates:',
        this.pendingIceCandidates.length
      );

      return;
    }

    try {
      const candidate =
        new RTCIceCandidate(
          candidateInit
        );

      await this.peerConnection
        .addIceCandidate(candidate);

      console.log(
        '[WebRTC] Remote ICE candidate added'
      );
    } catch (error) {
      console.error(
        '[WebRTC] Error adding ICE candidate:',
        error
      );
    }
  }

  // ============================================================
  // FLUSH QUEUED ICE CANDIDATES
  // ============================================================

  async flushPendingIceCandidates() {
    if (
      !this.peerConnection ||
      !this.peerConnection.remoteDescription
    ) {
      console.log(
        '[WebRTC] Cannot flush ICE yet'
      );

      return;
    }

    if (
      this.pendingIceCandidates.length === 0
    ) {
      return;
    }

    console.log(
      '[WebRTC] Flushing pending ICE candidates:',
      this.pendingIceCandidates.length
    );

    const candidates =
      [...this.pendingIceCandidates];

    this.pendingIceCandidates = [];

    for (
      const candidateInit of candidates
    ) {
      try {
        await this.peerConnection
          .addIceCandidate(
            new RTCIceCandidate(
              candidateInit
            )
          );

        console.log(
          '[WebRTC] Queued ICE candidate added successfully'
        );
      } catch (error) {
        console.error(
          '[WebRTC] Failed to add queued ICE candidate:',
          error
        );
      }
    }
  }

  // ============================================================
  // TOGGLE MICROPHONE
  // ============================================================

  toggleAudio(enabled) {
    if (!this.localStream) {
      return;
    }

    this.localStream
      .getAudioTracks()
      .forEach(track => {
        track.enabled = enabled;
      });

    console.log(
      '[WebRTC] Microphone:',
      enabled ? 'enabled' : 'disabled'
    );
  }

  // ============================================================
  // TOGGLE CAMERA
  // ============================================================

  toggleVideo(enabled) {
    if (!this.localStream) {
      return;
    }

    this.localStream
      .getVideoTracks()
      .forEach(track => {
        track.enabled = enabled;
      });

    console.log(
      '[WebRTC] Camera:',
      enabled ? 'enabled' : 'disabled'
    );
  }

  // ============================================================
  // SWITCH CAMERA
  // ============================================================

  async switchCamera() {
    if (this.isSynthetic) {
      Utils.showToast(
        'Using virtual camera in preview mode.',
        'info'
      );

      return;
    }

    if (!this.localStream) {
      return;
    }

    const currentVideoTrack =
      this.localStream
        .getVideoTracks()[0];

    if (!currentVideoTrack) {
      return;
    }

    this.currentFacingMode =
      this.currentFacingMode === 'user'
        ? 'environment'
        : 'user';

    try {
      const newStream =
        await navigator.mediaDevices
          .getUserMedia({
            video: {
              facingMode:
                this.currentFacingMode
            }
          });

      const newVideoTrack =
        newStream
          .getVideoTracks()[0];

      if (!newVideoTrack) {
        throw new Error(
          'New camera track unavailable'
        );
      }

      // Replace WebRTC sender track.
      if (this.peerConnection) {
        const senders =
          this.peerConnection
            .getSenders();

        const sender =
          senders.find(
            s =>
              s.track &&
              s.track.kind === 'video'
          );

        if (sender) {
          await sender.replaceTrack(
            newVideoTrack
          );
        }
      }

      // Replace local track.
      currentVideoTrack.stop();

      this.localStream
        .removeTrack(
          currentVideoTrack
        );

      this.localStream
        .addTrack(
          newVideoTrack
        );

      console.log(
        '[WebRTC] Camera switched to:',
        this.currentFacingMode
      );

      return newVideoTrack;
    } catch (error) {
      console.warn(
        '[WebRTC] Camera switch failed:',
        error
      );
    }
  }

  // ============================================================
  // GET REMOTE STREAM
  // ============================================================

  getRemoteStream() {
    return this.remoteStream;
  }

  // ============================================================
  // GET CONNECTION STATE
  // ============================================================

  getConnectionState() {
    if (!this.peerConnection) {
      return 'closed';
    }

    return this.peerConnection
      .connectionState;
  }

  // ============================================================
  // GET ICE CONNECTION STATE
  // ============================================================

  getIceConnectionState() {
    if (!this.peerConnection) {
      return 'closed';
    }

    return this.peerConnection
      .iceConnectionState;
  }

  // ============================================================
  // CLEANUP
  // ============================================================

  cleanup() {
    console.log(
      '[WebRTC] Cleaning up call'
    );

    // Stop synthetic video animation.
    if (this.syntheticAnimationTimer) {
      clearInterval(
        this.syntheticAnimationTimer
      );

      this.syntheticAnimationTimer =
        null;
    }

    // Stop local tracks.
    if (this.localStream) {
      this.localStream
        .getTracks()
        .forEach(track => {
          try {
            track.stop();
          } catch (error) {
            console.warn(
              '[WebRTC] Error stopping track:',
              error
            );
          }
        });

      this.localStream = null;
    }

    // Close peer connection.
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (error) {
        console.warn(
          '[WebRTC] Error closing PeerConnection:',
          error
        );
      }

      this.peerConnection = null;
    }

    // Close synthetic audio context.
    if (this.syntheticAudioContext) {
      try {
        this.syntheticAudioContext.close();
      } catch (error) {
        console.warn(
          '[WebRTC] Error closing audio context:',
          error
        );
      }

      this.syntheticAudioContext =
        null;
    }

    // Reset remote stream.
    this.remoteStream = null;

    // VERY IMPORTANT:
    // Clear stale ICE candidates when
    // the call is completely over.
    this.pendingIceCandidates = [];

    this.isSynthetic = false;

    console.log(
      '[WebRTC] Cleanup complete'
    );
  }
}


// ================================================================
// GLOBAL WEBRTC INSTANCE
// ================================================================

const webrtc =
  new WebRTCClient();
