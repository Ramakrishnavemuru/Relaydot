// ============================================================
// Relay WebRTC Client
// Handles:
// - Camera / microphone acquisition
// - WebRTC PeerConnection
// - SDP offer / answer
// - ICE candidate exchange
// - Remote audio / video tracks
// - Camera switching
// - Microphone / camera toggling
// - Hardware fallbacks
// - Connection diagnostics
// ============================================================

class WebRTCClient {

  constructor() {

    // ----------------------------------------------------------
    // Peer connection state
    // ----------------------------------------------------------

    this.peerConnection = null;

    this.localStream = null;

    this.remoteStream = null;


    // ----------------------------------------------------------
    // ICE servers
    // ----------------------------------------------------------
    // Backend /calls/config can replace these with STUN + TURN.

    this.iceServers = [
      {
        urls: 'stun:stun.l.google.com:19302'
      },
      {
        urls: 'stun:stun1.l.google.com:19302'
      }
    ];


    // ----------------------------------------------------------
    // ICE candidate queue
    // ----------------------------------------------------------
    // Important:
    // ICE candidates can arrive before:
    //
    // 1. PeerConnection exists
    // 2. Remote description has been set
    //
    // We therefore queue them and add them later.

    this.pendingIceCandidates = [];


    // ----------------------------------------------------------
    // Camera state
    // ----------------------------------------------------------

    this.currentFacingMode = 'user';


    // ----------------------------------------------------------
    // Synthetic stream state
    // ----------------------------------------------------------

    this.syntheticAnimationTimer = null;

    this.syntheticAudioContext = null;

    this.isSynthetic = false;


    // ----------------------------------------------------------
    // Callbacks
    // ----------------------------------------------------------

    this.onRemoteStreamCallback = null;

    this.onIceCandidateCallback = null;

    this.onConnectionStateChangeCallback = null;

    this.onIceConnectionStateChangeCallback = null;

    this.onIceGatheringStateChangeCallback = null;
  }


  // ==========================================================
  // LOAD ICE CONFIGURATION
  // ==========================================================

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
          this.iceServers
        );

      } else {

        console.warn(
          '[WebRTC] Backend returned no ICE servers. Using fallback STUN.'
        );

      }

    } catch (e) {

      console.warn(
        '[WebRTC] Could not load ICE configuration. Using fallback STUN servers.',
        e
      );

    }
  }


  // ==========================================================
  // GET CAMERA / MICROPHONE
  // ==========================================================

  async getMediaStream(callType = 'video') {

    const isVideo = callType === 'video';

    this.isSynthetic = false;


    // ----------------------------------------------------------
    // Secure context check
    // ----------------------------------------------------------

    if (window.isSecureContext === false) {

      console.warn(
        '[WebRTC] Insecure origin. getUserMedia requires HTTPS or localhost.'
      );

      if (
        typeof Utils !== 'undefined' &&
        Utils.showToast
      ) {

        Utils.showToast(
          'Camera/mic access requires HTTPS or localhost.',
          'warning'
        );

      }
    }


    // ----------------------------------------------------------
    // Check browser media support
    // ----------------------------------------------------------

    if (
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    ) {

      // ========================================================
      // ATTEMPT 1
      // ========================================================

      try {

        console.log(
          '[WebRTC] Requesting media with ideal constraints...'
        );

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
          '[WebRTC] Media acquired successfully.',
          this.getStreamInfo(this.localStream)
        );

        return this.localStream;

      } catch (err1) {

        console.warn(
          '[WebRTC] Media attempt 1 failed:',
          err1.name,
          err1.message
        );


        // ======================================================
        // ATTEMPT 2
        // ======================================================

        try {

          console.log(
            '[WebRTC] Trying simplified media constraints...'
          );

          this.localStream =
            await navigator.mediaDevices.getUserMedia({

              audio: true,

              video: isVideo
                ? true
                : false
            });


          console.log(
            '[WebRTC] Simplified media acquired successfully.',
            this.getStreamInfo(this.localStream)
          );

          return this.localStream;

        } catch (err2) {

          console.warn(
            '[WebRTC] Media attempt 2 failed:',
            err2.name,
            err2.message
          );


          // ====================================================
          // ATTEMPT 3
          // ====================================================
          // If video call was requested but camera fails,
          // keep the REAL microphone and create a virtual video.

          if (isVideo) {

            try {

              console.log(
                '[WebRTC] Camera unavailable. Trying audio-only + virtual video...'
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

                audioStream.addTrack(
                  syntheticVideo
                );

              }


              this.localStream = audioStream;

              this.isSynthetic = true;


              if (
                typeof Utils !== 'undefined' &&
                Utils.showToast
              ) {

                Utils.showToast(
                  'Camera unavailable. Using virtual video with your real microphone.',
                  'info'
                );

              }


              console.log(
                '[WebRTC] Audio-only + virtual video fallback active.',
                this.getStreamInfo(this.localStream)
              );


              return this.localStream;

            } catch (err3) {

              console.warn(
                '[WebRTC] Audio-only fallback failed:',
                err3.name,
                err3.message
              );

            }
          }
        }
      }
    }


    // ========================================================
    // FINAL FALLBACK
    // ========================================================
    // Hardware unavailable / permission denied / unsupported.
    //
    // This creates a synthetic stream.
    //
    // IMPORTANT:
    // Synthetic audio is intentionally silent.
    // It is only a fallback for testing WebRTC signalling/media
    // connection when no microphone is available.

    console.info(
      '[WebRTC] Falling back to synthetic virtual stream.'
    );


    this.isSynthetic = true;


    const syntheticStream =
      new MediaStream();


    const syntheticAudio =
      this.createSyntheticAudioTrack();


    if (syntheticAudio) {

      syntheticStream.addTrack(
        syntheticAudio
      );

    }


    if (isVideo) {

      const syntheticVideo =
        this.createSyntheticVideoTrack();


      if (syntheticVideo) {

        syntheticStream.addTrack(
          syntheticVideo
        );

      }
    }


    this.localStream =
      syntheticStream;


    if (
      typeof Utils !== 'undefined' &&
      Utils.showToast
    ) {

      Utils.showToast(
        'Using virtual audio/video stream. Camera or microphone was not detected or permission was blocked.',
        'info',
        5000
      );

    }


    console.log(
      '[WebRTC] Synthetic stream created:',
      this.getStreamInfo(this.localStream)
    );


    return this.localStream;
  }


  // ==========================================================
  // STREAM DEBUG INFORMATION
  // ==========================================================

  getStreamInfo(stream) {

    if (!stream) {

      return {
        audioTracks: 0,
        videoTracks: 0
      };

    }


    return {

      audioTracks:
        stream.getAudioTracks().map(track => ({
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState
        })),

      videoTracks:
        stream.getVideoTracks().map(track => ({
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState
        }))
    };
  }


  // ==========================================================
  // CREATE SYNTHETIC VIDEO TRACK
  // ==========================================================

  createSyntheticVideoTrack() {

    try {

      const canvas =
        document.createElement('canvas');


      canvas.width = 640;
      canvas.height = 480;


      const ctx =
        canvas.getContext('2d');


      if (!ctx) {

        console.warn(
          '[WebRTC] Canvas 2D context unavailable.'
        );

        return null;
      }


      const currentUser =
        (
          typeof Auth !== 'undefined' &&
          Auth.getCurrentUser
        )
          ? Auth.getCurrentUser()
          : {
              display_name: 'You',
              username: 'you'
            };


      const name =
        currentUser.display_name ||
        currentUser.username ||
        'You';


      let wave = 0;


      const drawFrame = () => {

        wave += 0.05;


        // ------------------------------------------------------
        // Background
        // ------------------------------------------------------

        const grad =
          ctx.createLinearGradient(
            0,
            0,
            640,
            480
          );


        grad.addColorStop(
          0,
          '#1e1b4b'
        );


        grad.addColorStop(
          1,
          '#0f172a'
        );


        ctx.fillStyle = grad;

        ctx.fillRect(
          0,
          0,
          640,
          480
        );


        // ------------------------------------------------------
        // Ripple
        // ------------------------------------------------------

        const radius =
          80 +
          Math.sin(wave) * 10;


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


        // ------------------------------------------------------
        // Avatar
        // ------------------------------------------------------

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


        // ------------------------------------------------------
        // Initial
        // ------------------------------------------------------

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


        // ------------------------------------------------------
        // Name
        // ------------------------------------------------------

        ctx.font =
          '600 24px sans-serif';


        ctx.fillText(
          name,
          320,
          340
        );


        // ------------------------------------------------------
        // Status
        // ------------------------------------------------------

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


      // --------------------------------------------------------
      // Keep reference so cleanup() can stop it.
      // --------------------------------------------------------

      this.syntheticAnimationTimer =
        setInterval(
          drawFrame,
          100
        );


      // --------------------------------------------------------
      // Capture canvas as video stream
      // --------------------------------------------------------

      if (
        typeof canvas.captureStream === 'function'
      ) {

        const stream =
          canvas.captureStream(20);


        const tracks =
          stream.getVideoTracks();


        if (
          tracks &&
          tracks.length > 0
        ) {

          return tracks[0];

        }
      }


      console.warn(
        '[WebRTC] Canvas captureStream unavailable.'
      );


    } catch (e) {

      console.warn(
        '[WebRTC] Could not create synthetic video track:',
        e
      );

    }


    return null;
  }


  // ==========================================================
  // CREATE SYNTHETIC AUDIO TRACK
  // ==========================================================
  // This is intentionally silent.
  //
  // It is NOT a microphone replacement.
  // It only provides an audio MediaStreamTrack so WebRTC can
  // still negotiate an audio track during fallback/testing.

  createSyntheticAudioTrack() {

    try {

      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;


      if (!AudioCtx) {

        console.warn(
          '[WebRTC] Web Audio API is unavailable.'
        );

        return null;
      }


      const ctx =
        new AudioCtx();


      this.syntheticAudioContext =
        ctx;


      const osc =
        ctx.createOscillator();


      const gain =
        ctx.createGain();


      const destination =
        ctx.createMediaStreamDestination();


      // Very low gain = effectively silent.
      gain.gain.value = 0.0001;


      osc.connect(gain);

      gain.connect(destination);


      osc.start();


      const tracks =
        destination.stream.getAudioTracks();


      if (
        tracks &&
        tracks.length > 0
      ) {

        return tracks[0];

      }


    } catch (e) {

      console.warn(
        '[WebRTC] Could not create synthetic audio track:',
        e
      );

    }


    return null;
  }


  // ==========================================================
  // CREATE PEER CONNECTION
  // ==========================================================

  createPeerConnection() {

    // ----------------------------------------------------------
    // Close an old connection first
    // ----------------------------------------------------------

    if (this.peerConnection) {

      try {

        this.peerConnection.close();

      } catch (e) {

        console.warn(
          '[WebRTC] Error closing old peer connection:',
          e
        );

      }

      this.peerConnection = null;
    }


    // ----------------------------------------------------------
    // Reset remote stream
    // ----------------------------------------------------------

    this.remoteStream =
      new MediaStream();


    // ----------------------------------------------------------
    // Reset candidate queue
    // ----------------------------------------------------------

    this.pendingIceCandidates = [];


    // ----------------------------------------------------------
    // Create RTCPeerConnection
    // ----------------------------------------------------------

    console.log(
      '[WebRTC] Creating RTCPeerConnection with ICE servers:',
      this.iceServers
    );


    this.peerConnection =
      new RTCPeerConnection({

        iceServers:
          this.iceServers,

        // Give the browser some flexibility in connectivity.
        iceCandidatePoolSize: 10
      });


    // ========================================================
    // ADD LOCAL TRACKS
    // ========================================================

    if (this.localStream) {

      const localTracks =
        this.localStream.getTracks();


      console.log(
        '[WebRTC] Adding local tracks:',
        localTracks.map(track => ({
          kind: track.kind,
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState
        }))
      );


      localTracks.forEach(track => {

        try {

          this.peerConnection.addTrack(
            track,
            this.localStream
          );

        } catch (e) {

          console.error(
            '[WebRTC] Failed to add local track:',
            track.kind,
            e
          );

        }

      });

    } else {

      console.warn(
        '[WebRTC] No local stream exists when creating PeerConnection.'
      );

    }


    // ========================================================
    // REMOTE TRACK HANDLER
    // ========================================================

    this.peerConnection.ontrack =
      (event) => {

        const track =
          event.track;


        console.log(
          '[WebRTC] Received remote track:',
          {
            kind: track.kind,
            id: track.id,
            label: track.label,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState
          }
        );


        // ----------------------------------------------------
        // Add the individual track directly.
        //
        // This is safer than relying only on event.streams[0].
        // ----------------------------------------------------

        if (track) {

          const alreadyExists =
            this.remoteStream
              .getTracks()
              .some(
                existingTrack =>
                  existingTrack.id === track.id
              );


          if (!alreadyExists) {

            this.remoteStream.addTrack(
              track
            );

          }

        }


        // ----------------------------------------------------
        // If the browser supplied a MediaStream, also make sure
        // all tracks from it are available.
        // ----------------------------------------------------

        if (
          event.streams &&
          event.streams.length > 0
        ) {

          const remoteEventStream =
            event.streams[0];


          remoteEventStream
            .getTracks()
            .forEach(remoteTrack => {

              const exists =
                this.remoteStream
                  .getTracks()
                  .some(
                    existingTrack =>
                      existingTrack.id ===
                      remoteTrack.id
                  );


              if (!exists) {

                this.remoteStream.addTrack(
                  remoteTrack
                );

              }

            });

        }


        // ----------------------------------------------------
        // Log current remote media
        // ----------------------------------------------------

        console.log(
          '[WebRTC] Remote stream updated:',
          {
            audioTracks:
              this.remoteStream
                .getAudioTracks()
                .length,

            videoTracks:
              this.remoteStream
                .getVideoTracks()
                .length
          }
        );


        // ----------------------------------------------------
        // Notify calls.js
        // ----------------------------------------------------

        if (
          typeof this.onRemoteStreamCallback ===
          'function'
        ) {

          this.onRemoteStreamCallback(
            this.remoteStream
          );

        }
      };


    // ========================================================
    // LOCAL ICE CANDIDATE
    // ========================================================

    this.peerConnection.onicecandidate =
      (event) => {

        if (!event.candidate) {

          console.log(
            '[WebRTC] ICE gathering completed.'
          );

          return;
        }


        console.log(
          '[WebRTC] Local ICE candidate:',
          {
            candidate:
              event.candidate.candidate,

            sdpMid:
              event.candidate.sdpMid,

            sdpMLineIndex:
              event.candidate.sdpMLineIndex
          }
        );


        if (
          typeof this.onIceCandidateCallback ===
          'function'
        ) {

          this.onIceCandidateCallback(
            event.candidate
          );

        } else {

          console.warn(
            '[WebRTC] ICE candidate callback is not configured.'
          );

        }
      };


    // ========================================================
    // CONNECTION STATE
    // ========================================================

    this.peerConnection.onconnectionstatechange =
      () => {

        if (!this.peerConnection) {
          return;
        }


        const state =
          this.peerConnection.connectionState;


        console.log(
          '[WebRTC] Connection state changed:',
          state
        );


        if (
          typeof this.onConnectionStateChangeCallback ===
          'function'
        ) {

          this.onConnectionStateChangeCallback(
            state
          );

        }
      };


    // ========================================================
    // ICE CONNECTION STATE
    // ========================================================

    this.peerConnection.oniceconnectionstatechange =
      () => {

        if (!this.peerConnection) {
          return;
        }


        const state =
          this.peerConnection.iceConnectionState;


        console.log(
          '[WebRTC] ICE connection state:',
          state
        );


        if (
          typeof this.onIceConnectionStateChangeCallback ===
          'function'
        ) {

          this.onIceConnectionStateChangeCallback(
            state
          );

        }
      };


    // ========================================================
    // ICE GATHERING STATE
    // ========================================================

    this.peerConnection.onicegatheringstatechange =
      () => {

        if (!this.peerConnection) {
          return;
        }


        console.log(
          '[WebRTC] ICE gathering state:',
          this.peerConnection.iceGatheringState
        );


        if (
          typeof this.onIceGatheringStateChangeCallback ===
          'function'
        ) {

          this.onIceGatheringStateChangeCallback(
            this.peerConnection.iceGatheringState
          );

        }
      };


    // ========================================================
    // SIGNALING STATE
    // ========================================================

    this.peerConnection.onsignalingstatechange =
      () => {

        if (!this.peerConnection) {
          return;
        }


        console.log(
          '[WebRTC] Signaling state:',
          this.peerConnection.signalingState
        );
      };


    // ========================================================
    // ICE CANDIDATE ERROR
    // ========================================================

    this.peerConnection.onicecandidateerror =
      (event) => {

        console.warn(
          '[WebRTC] ICE candidate error:',
          {
            errorCode: event.errorCode,
            errorText: event.errorText,
            url: event.url,
            address: event.address,
            port: event.port
          }
        );
      };


    return this.peerConnection;
  }


  // ==========================================================
  // CREATE SDP OFFER
  // ==========================================================

  async createOffer() {

    if (!this.peerConnection) {

      this.createPeerConnection();

    }


    if (!this.peerConnection) {

      throw new Error(
        'Unable to create WebRTC peer connection.'
      );

    }


    console.log(
      '[WebRTC] Creating SDP offer...'
    );


    const offer =
      await this.peerConnection.createOffer({

        offerToReceiveAudio: true,

        offerToReceiveVideo: true

      });


    console.log(
      '[WebRTC] SDP offer created.'
    );


    await this.peerConnection.setLocalDescription(
      offer
    );


    console.log(
      '[WebRTC] Local SDP description set.'
    );


    return offer;
  }


  // ==========================================================
  // HANDLE OFFER AND CREATE ANSWER
  // ==========================================================

  async handleOfferAndCreateAnswer(offerSdp) {

    if (!offerSdp) {

      throw new Error(
        'No offer SDP received.'
      );

    }


    if (!this.peerConnection) {

      this.createPeerConnection();

    }


    if (!this.peerConnection) {

      throw new Error(
        'Unable to create WebRTC peer connection.'
      );

    }


    console.log(
      '[WebRTC] Setting remote offer...'
    );


    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(
        offerSdp
      )
    );


    console.log(
      '[WebRTC] Remote offer set successfully.'
    );


    // --------------------------------------------------------
    // IMPORTANT:
    // ICE candidates that arrived before the remote SDP are
    // now safe to add.
    // --------------------------------------------------------

    await this.flushPendingIceCandidates();


    console.log(
      '[WebRTC] Creating SDP answer...'
    );


    const answer =
      await this.peerConnection.createAnswer();


    await this.peerConnection.setLocalDescription(
      answer
    );


    console.log(
      '[WebRTC] Local SDP answer set.'
    );


    return answer;
  }


  // ==========================================================
  // HANDLE ANSWER
  // ==========================================================

  async handleAnswer(answerSdp) {

    if (!answerSdp) {

      throw new Error(
        'No answer SDP received.'
      );

    }


    if (!this.peerConnection) {

      console.warn(
        '[WebRTC] Received answer but peer connection does not exist.'
      );

      return;

    }


    console.log(
      '[WebRTC] Setting remote answer...'
    );


    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(
        answerSdp
      )
    );


    console.log(
      '[WebRTC] Remote answer set successfully.'
    );


    // --------------------------------------------------------
    // Flush candidates that arrived before the answer.
    // --------------------------------------------------------

    await this.flushPendingIceCandidates();
  }


  // ==========================================================
  // ADD REMOTE ICE CANDIDATE
  // ==========================================================

  async addIceCandidate(candidateInit) {

    if (!candidateInit) {

      console.warn(
        '[WebRTC] Empty ICE candidate received.'
      );

      return;
    }


    // --------------------------------------------------------
    // If PeerConnection does not exist yet, queue it.
    // --------------------------------------------------------

    if (!this.peerConnection) {

      console.log(
        '[WebRTC] Queueing ICE candidate because PeerConnection is not ready.'
      );


      this.pendingIceCandidates.push(
        candidateInit
      );


      return;
    }


    // --------------------------------------------------------
    // If remote description has not been set yet, queue it.
    // --------------------------------------------------------

    if (
      !this.peerConnection.remoteDescription
    ) {

      console.log(
        '[WebRTC] Queueing ICE candidate because remote description is not ready.'
      );


      this.pendingIceCandidates.push(
        candidateInit
      );


      return;
    }


    // --------------------------------------------------------
    // Add immediately.
    // --------------------------------------------------------

    try {

      const candidate =
        candidateInit instanceof RTCIceCandidate
          ? candidateInit
          : new RTCIceCandidate(
              candidateInit
            );


      await this.peerConnection.addIceCandidate(
        candidate
      );


      console.log(
        '[WebRTC] Remote ICE candidate added successfully.'
      );


    } catch (err) {

      console.warn(
        '[WebRTC] Error adding ICE candidate:',
        err
      );

    }
  }


  // ==========================================================
  // FLUSH QUEUED ICE CANDIDATES
  // ==========================================================

  async flushPendingIceCandidates() {

    if (
      !this.peerConnection
    ) {

      return;
    }


    if (
      !this.peerConnection.remoteDescription
    ) {

      console.log(
        '[WebRTC] Cannot flush ICE candidates yet. Remote description is missing.'
      );

      return;
    }


    if (
      this.pendingIceCandidates.length === 0
    ) {

      return;
    }


    console.log(
      `[WebRTC] Flushing ${this.pendingIceCandidates.length} queued ICE candidate(s)...`
    );


    const candidates =
      [...this.pendingIceCandidates];


    this.pendingIceCandidates = [];


    for (
      const candidateInit of candidates
    ) {

      try {

        const candidate =
          candidateInit instanceof RTCIceCandidate
            ? candidateInit
            : new RTCIceCandidate(
                candidateInit
              );


        await this.peerConnection.addIceCandidate(
          candidate
        );


        console.log(
          '[WebRTC] Queued ICE candidate added.'
        );


      } catch (err) {

        console.warn(
          '[WebRTC] Failed to add queued ICE candidate:',
          err
        );

      }
    }
  }


  // ==========================================================
  // TOGGLE MICROPHONE
  // ==========================================================

  toggleAudio(enabled) {

    if (!this.localStream) {

      console.warn(
        '[WebRTC] Cannot toggle microphone: no local stream.'
      );

      return;
    }


    const audioTracks =
      this.localStream.getAudioTracks();


    console.log(
      '[WebRTC] Setting microphone enabled:',
      enabled
    );


    audioTracks.forEach(track => {

      track.enabled =
        Boolean(enabled);

    });
  }


  // ==========================================================
  // TOGGLE CAMERA
  // ==========================================================

  toggleVideo(enabled) {

    if (!this.localStream) {

      console.warn(
        '[WebRTC] Cannot toggle camera: no local stream.'
      );

      return;
    }


    const videoTracks =
      this.localStream.getVideoTracks();


    console.log(
      '[WebRTC] Setting camera enabled:',
      enabled
    );


    videoTracks.forEach(track => {

      track.enabled =
        Boolean(enabled);

    });
  }


  // ==========================================================
  // SWITCH CAMERA
  // ==========================================================

  async switchCamera() {

    // --------------------------------------------------------
    // Synthetic camera
    // --------------------------------------------------------

    if (this.isSynthetic) {

      if (
        typeof Utils !== 'undefined' &&
        Utils.showToast
      ) {

        Utils.showToast(
          'Using virtual camera in preview mode.',
          'info'
        );

      }

      return null;
    }


    // --------------------------------------------------------
    // Check local stream
    // --------------------------------------------------------

    if (!this.localStream) {

      console.warn(
        '[WebRTC] Cannot switch camera: no local stream.'
      );

      return null;
    }


    const videoTrack =
      this.localStream.getVideoTracks()[0];


    if (!videoTrack) {

      console.warn(
        '[WebRTC] Cannot switch camera: no video track.'
      );

      return null;
    }


    // --------------------------------------------------------
    // Toggle facing mode
    // --------------------------------------------------------

    this.currentFacingMode =
      this.currentFacingMode === 'user'
        ? 'environment'
        : 'user';


    console.log(
      '[WebRTC] Switching camera to:',
      this.currentFacingMode
    );


    try {

      const newStream =
        await navigator.mediaDevices.getUserMedia({

          video: {
            facingMode:
              this.currentFacingMode
          },

          audio: false

        });


      const newVideoTrack =
        newStream.getVideoTracks()[0];


      if (!newVideoTrack) {

        throw new Error(
          'New camera did not provide a video track.'
        );

      }


      // ------------------------------------------------------
      // Replace WebRTC sender track
      // ------------------------------------------------------

      if (this.peerConnection) {

        const senders =
          this.peerConnection.getSenders();


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


          console.log(
            '[WebRTC] Camera sender track replaced.'
          );

        } else {

          console.warn(
            '[WebRTC] No video sender found.'
          );

        }
      }


      // ------------------------------------------------------
      // Replace local stream track
      // ------------------------------------------------------

      videoTrack.stop();


      this.localStream.removeTrack(
        videoTrack
      );


      this.localStream.addTrack(
        newVideoTrack
      );


      console.log(
        '[WebRTC] Camera switched successfully.'
      );


      return newVideoTrack;


    } catch (e) {

      console.warn(
        '[WebRTC] Camera switch failed:',
        e
      );


      // ------------------------------------------------------
      // Restore previous facing mode because switching failed.
      // ------------------------------------------------------

      this.currentFacingMode =
        this.currentFacingMode === 'user'
          ? 'environment'
          : 'user';


      return null;
    }
  }


  // ==========================================================
  // GET LOCAL AUDIO TRACK
  // ==========================================================

  getAudioTrack() {

    if (!this.localStream) {

      return null;
    }


    return this.localStream
      .getAudioTracks()[0] || null;
  }


  // ==========================================================
  // GET LOCAL VIDEO TRACK
  // ==========================================================

  getVideoTrack() {

    if (!this.localStream) {

      return null;
    }


    return this.localStream
      .getVideoTracks()[0] || null;
  }


  // ==========================================================
  // GET REMOTE AUDIO TRACKS
  // ==========================================================

  getRemoteAudioTracks() {

    if (!this.remoteStream) {

      return [];
    }


    return this.remoteStream
      .getAudioTracks();
  }


  // ==========================================================
  // GET REMOTE VIDEO TRACKS
  // ==========================================================

  getRemoteVideoTracks() {

    if (!this.remoteStream) {

      return [];
    }


    return this.remoteStream
      .getVideoTracks();
  }


  // ==========================================================
  // DEBUG STATE
  // ==========================================================

  getConnectionInfo() {

    if (!this.peerConnection) {

      return {
        peerConnection: false,
        connectionState: null,
        iceConnectionState: null,
        iceGatheringState: null,
        signalingState: null
      };
    }


    return {

      peerConnection: true,

      connectionState:
        this.peerConnection.connectionState,

      iceConnectionState:
        this.peerConnection.iceConnectionState,

      iceGatheringState:
        this.peerConnection.iceGatheringState,

      signalingState:
        this.peerConnection.signalingState,

      localDescription:
        Boolean(
          this.peerConnection.localDescription
        ),

      remoteDescription:
        Boolean(
          this.peerConnection.remoteDescription
        ),

      pendingIceCandidates:
        this.pendingIceCandidates.length,

      localAudioTracks:
        this.localStream
          ? this.localStream
              .getAudioTracks()
              .length
          : 0,

      localVideoTracks:
        this.localStream
          ? this.localStream
              .getVideoTracks()
              .length
          : 0,

      remoteAudioTracks:
        this.remoteStream
          ? this.remoteStream
              .getAudioTracks()
              .length
          : 0,

      remoteVideoTracks:
        this.remoteStream
          ? this.remoteStream
              .getVideoTracks()
              .length
          : 0
    };
  }


  // ==========================================================
  // CLEANUP
  // ==========================================================

  cleanup() {

    console.log(
      '[WebRTC] Cleaning up WebRTC resources...'
    );


    // --------------------------------------------------------
    // Stop synthetic video animation
    // --------------------------------------------------------

    if (
      this.syntheticAnimationTimer
    ) {

      clearInterval(
        this.syntheticAnimationTimer
      );


      this.syntheticAnimationTimer =
        null;
    }


    // --------------------------------------------------------
    // Stop local media tracks
    // --------------------------------------------------------

    if (this.localStream) {

      this.localStream
        .getTracks()
        .forEach(track => {

          try {

            track.stop();

          } catch (e) {

            console.warn(
              '[WebRTC] Error stopping local track:',
              e
            );

          }

        });


      this.localStream =
        null;
    }


    // --------------------------------------------------------
    // Close peer connection
    // --------------------------------------------------------

    if (this.peerConnection) {

      try {

        this.peerConnection.close();

      } catch (e) {

        console.warn(
          '[WebRTC] Error closing PeerConnection:',
          e
        );

      }


      this.peerConnection =
        null;
    }


    // --------------------------------------------------------
    // Close synthetic audio context
    // --------------------------------------------------------

    if (
      this.syntheticAudioContext
    ) {

      try {

        this.syntheticAudioContext.close();

      } catch (e) {

        console.warn(
          '[WebRTC] Error closing synthetic AudioContext:',
          e
        );

      }


      this.syntheticAudioContext =
        null;
    }


    // --------------------------------------------------------
    // Reset remote stream
    // --------------------------------------------------------

    this.remoteStream =
      null;


    // --------------------------------------------------------
    // Clear ICE queue
    // --------------------------------------------------------

    this.pendingIceCandidates =
      [];


    // --------------------------------------------------------
    // Reset synthetic state
    // --------------------------------------------------------

    this.isSynthetic =
      false;


    console.log(
      '[WebRTC] Cleanup complete.'
    );
  }
}


// ============================================================
// GLOBAL WEBRTC INSTANCE
// ============================================================

const webrtc =
  new WebRTCClient();
