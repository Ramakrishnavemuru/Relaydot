// ================================================================
// REAL-TIME CALL CONTROLLER
// Voice + Video Calls
// ================================================================

const Calls = {
  activeCall: null,

  callTimer: null,
  callSeconds: 0,

  ringtoneInterval: null,

  isAudioMuted: false,
  isVideoMuted: false,

  // UI Elements cache
  elements: {},

  // ==============================================================
  // INITIALIZATION
  // ==============================================================

  init() {
    console.log('[Calls] Initializing call controller...');

    this.elements = {
      // ------------------------------------------------------------
      // Incoming Call Banner
      // ------------------------------------------------------------

      incomingOverlay:
        Utils.$('#incoming-call-overlay'),

      incomingAvatar:
        Utils.$('#incoming-caller-avatar'),

      incomingName:
        Utils.$('#incoming-caller-name'),

      incomingType:
        Utils.$('#incoming-call-type'),

      btnAccept:
        Utils.$('#btn-accept-call'),

      btnDecline:
        Utils.$('#btn-decline-call'),


      // ------------------------------------------------------------
      // Call Modal
      // ------------------------------------------------------------

      callModal:
        Utils.$('#call-modal-overlay'),

      peerName:
        Utils.$('#call-peer-name'),

      callTimerEl:
        Utils.$('#call-timer'),

      voiceStage:
        Utils.$('#voice-call-stage'),

      voiceAvatar:
        Utils.$('#voice-call-avatar'),

      videoStage:
        Utils.$('#video-call-stage'),

      remoteVideo:
        Utils.$('#remote-video-el'),

      localVideo:
        Utils.$('#local-video-el'),

      // IMPORTANT:
      // Remote audio element.
      remoteAudio:
        Utils.$('#remote-audio-el'),


      // ------------------------------------------------------------
      // Call Controls
      // ------------------------------------------------------------

      btnMuteMic:
        Utils.$('#btn-call-mute-mic'),

      btnToggleCam:
        Utils.$('#btn-call-toggle-cam'),

      btnSwitchCam:
        Utils.$('#btn-call-switch-cam'),

      btnEndCall:
        Utils.$('#btn-call-end')
    };

    // Load STUN/TURN configuration.
    // We intentionally don't block the UI initialization.
    webrtc
      .initConfig()
      .catch(error => {
        console.warn(
          '[Calls] WebRTC config initialization failed:',
          error
        );
      });

    this.bindSocketEvents();
    this.bindUI();

    console.log('[Calls] Call controller initialized');
  },


  // ==============================================================
  // SOCKET EVENTS
  // ==============================================================

  bindSocketEvents() {

    // ------------------------------------------------------------
    // 1. Incoming Call Invite
    // ------------------------------------------------------------

    WSClient.on('call_invite', (data) => {
      console.log(
        '[Calls] Incoming call invite:',
        data
      );

      this.handleIncomingInvite(data);
    });


    // ------------------------------------------------------------
    // 2. Callee Accepted Call
    // ------------------------------------------------------------

    WSClient.on('call_accept', async (data) => {
      console.log(
        '[Calls] Call accepted:',
        data
      );

      await this.handleCallAccepted(data);
    });


    // ------------------------------------------------------------
    // 3. Callee Rejected Call
    // ------------------------------------------------------------

    WSClient.on('call_reject', (data) => {
      console.log(
        '[Calls] Call rejected:',
        data
      );

      this.handleCallRejected(data);
    });


    // ------------------------------------------------------------
    // 4. WebRTC Offer
    // ------------------------------------------------------------

    WSClient.on('webrtc_offer', async (data) => {
      console.log(
        '[Calls] WebRTC offer received'
      );

      await this.handleWebRtcOffer(data);
    });


    // ------------------------------------------------------------
    // 5. WebRTC Answer
    // ------------------------------------------------------------

    WSClient.on('webrtc_answer', async (data) => {
      console.log(
        '[Calls] WebRTC answer received'
      );

      await this.handleWebRtcAnswer(data);
    });


    // ------------------------------------------------------------
    // 6. ICE Candidate
    // ------------------------------------------------------------

    WSClient.on('ice_candidate', async (data) => {
      if (!data || !data.candidate) {
        return;
      }

      console.log(
        '[Calls] Remote ICE candidate received'
      );

      await webrtc.addIceCandidate(
        data.candidate
      );
    });


    // ------------------------------------------------------------
    // 7. Call End
    // ------------------------------------------------------------

    WSClient.on('call_end', () => {
      console.log(
        '[Calls] Peer ended the call'
      );

      Utils.showToast(
        'Call ended by peer',
        'info'
      );

      this.endCall(false);
    });


    // ============================================================
    // WEBRTC CALLBACKS
    // ============================================================


    // ------------------------------------------------------------
    // Remote Stream Callback
    // ------------------------------------------------------------

    webrtc.onRemoteStreamCallback =
      (remoteStream) => {

        console.log(
          '[Calls] Remote stream received:',
          remoteStream
        );

        const tracks =
          remoteStream.getTracks();

        console.log(
          '[Calls] Remote tracks:',
          tracks.map(track => ({
            kind: track.kind,
            id: track.id,
            readyState: track.readyState
          }))
        );


        // --------------------------------------------------------
        // Remote Video
        // --------------------------------------------------------

        if (this.elements.remoteVideo) {

          this.elements.remoteVideo.srcObject =
            remoteStream;

          this.elements.remoteVideo.autoplay =
            true;

          this.elements.remoteVideo.playsInline =
            true;

          this.elements.remoteVideo.muted =
            false;

          this.elements.remoteVideo.play()
            .then(() => {
              console.log(
                '[Calls] Remote video playback started'
              );
            })
            .catch(error => {
              console.warn(
                '[Calls] Remote video autoplay blocked:',
                error
              );
            });
        }


        // --------------------------------------------------------
        // Remote Audio
        // --------------------------------------------------------

        if (this.elements.remoteAudio) {

          this.elements.remoteAudio.srcObject =
            remoteStream;

          this.elements.remoteAudio.autoplay =
            true;

          this.elements.remoteAudio.playsInline =
            true;

          // IMPORTANT:
          // Never mute remote audio.
          this.elements.remoteAudio.muted =
            false;

          this.elements.remoteAudio.volume =
            1.0;

          this.elements.remoteAudio.play()
            .then(() => {
              console.log(
                '[Calls] Remote audio playback started'
              );
            })
            .catch(error => {

              console.warn(
                '[Calls] Remote audio autoplay blocked:',
                error
              );

              this.enableAudioPlaybackRetry();
            });
        }
      };


    // ------------------------------------------------------------
    // Local ICE Candidate Callback
    // ------------------------------------------------------------

    webrtc.onIceCandidateCallback =
      (candidate) => {

        if (!this.activeCall) {
          console.warn(
            '[Calls] Received ICE candidate without active call'
          );

          return;
        }

        console.log(
          '[Calls] Sending local ICE candidate'
        );

        WSClient.send(
          'ice_candidate',
          {
            target_user_id:
              this.activeCall.peerId,

            candidate:
              candidate
          }
        );
      };


    // ------------------------------------------------------------
    // WebRTC Connection State
    // ------------------------------------------------------------

    webrtc.onConnectionStateChangeCallback =
      (state) => {

        console.log(
          '[Calls] WebRTC connection state:',
          state
        );

        if (!this.activeCall) {
          return;
        }


        // --------------------------------------------------------
        // Connecting
        // --------------------------------------------------------

        if (state === 'new') {
          this.updateCallStatus(
            'Connecting...'
          );
        }


        if (state === 'connecting') {
          this.updateCallStatus(
            'Connecting...'
          );
        }


        // --------------------------------------------------------
        // CONNECTED
        // --------------------------------------------------------

        if (state === 'connected') {

          console.log(
            '[Calls] ================================='
          );

          console.log(
            '[Calls] 🎉 CALL CONNECTED'
          );

          console.log(
            '[Calls] ================================='
          );

          if (!this.callTimer) {
            this.startDurationTimer();
          }

          Utils.showToast(
            'Call connected',
            'success'
          );
        }


        // --------------------------------------------------------
        // DISCONNECTED
        // --------------------------------------------------------

        if (state === 'disconnected') {

          console.warn(
            '[Calls] WebRTC temporarily disconnected'
          );

          this.updateCallStatus(
            'Reconnecting...'
          );
        }


        // --------------------------------------------------------
        // FAILED
        // --------------------------------------------------------

        if (state === 'failed') {

          console.error(
            '[Calls] ================================='
          );

          console.error(
            '[Calls] ❌ WEBRTC CONNECTION FAILED'
          );

          console.error(
            '[Calls] ================================='
          );

          this.updateCallStatus(
            'Connection failed'
          );

          Utils.showToast(
            'Could not establish the call connection.',
            'error'
          );
        }


        // --------------------------------------------------------
        // CLOSED
        // --------------------------------------------------------

        if (state === 'closed') {

          console.log(
            '[Calls] WebRTC connection closed'
          );
        }
      };


    // ------------------------------------------------------------
    // ICE Connection State
    // ------------------------------------------------------------

    webrtc.onIceConnectionStateChangeCallback =
      (state) => {

        console.log(
          '[Calls] WebRTC ICE state:',
          state
        );

        if (!this.activeCall) {
          return;
        }


        if (state === 'new') {

          this.updateCallStatus(
            'Connecting...'
          );
        }


        if (state === 'checking') {

          console.log(
            '[Calls] ICE checking candidates...'
          );

          this.updateCallStatus(
            'Connecting...'
          );
        }


        if (
          state === 'connected' ||
          state === 'completed'
        ) {

          console.log(
            '[Calls] 🎉 ICE connection established'
          );

          if (!this.callTimer) {
            this.startDurationTimer();
          }
        }


        if (state === 'disconnected') {

          console.warn(
            '[Calls] ICE disconnected'
          );

          this.updateCallStatus(
            'Reconnecting...'
          );
        }


        if (state === 'failed') {

          console.error(
            '[Calls] ❌ ICE CONNECTION FAILED'
          );

          console.error(
            '[Calls] A TURN server may be required.'
          );

          this.updateCallStatus(
            'Connection failed'
          );
        }


        if (state === 'closed') {

          console.log(
            '[Calls] ICE connection closed'
          );
        }
      };
  },


  // ==============================================================
  // UI EVENTS
  // ==============================================================

  bindUI() {

    // ------------------------------------------------------------
    // Accept Call
    // ------------------------------------------------------------

    if (this.elements.btnAccept) {

      this.elements.btnAccept
        .addEventListener(
          'click',
          () => {
            this.acceptIncomingCall();
          }
        );
    }


    // ------------------------------------------------------------
    // Decline Call
    // ------------------------------------------------------------

    if (this.elements.btnDecline) {

      this.elements.btnDecline
        .addEventListener(
          'click',
          () => {
            this.declineIncomingCall();
          }
        );
    }


    // ------------------------------------------------------------
    // Microphone
    // ------------------------------------------------------------

    if (this.elements.btnMuteMic) {

      this.elements.btnMuteMic
        .addEventListener(
          'click',
          () => {

            this.isAudioMuted =
              !this.isAudioMuted;

            webrtc.toggleAudio(
              !this.isAudioMuted
            );

            this.elements.btnMuteMic
              .classList
              .toggle(
                'muted',
                this.isAudioMuted
              );

            this.elements.btnMuteMic.innerHTML =
              this.isAudioMuted
                ? '🔇'
                : '🎤';

            Utils.showToast(
              this.isAudioMuted
                ? 'Microphone muted'
                : 'Microphone unmuted',
              'info'
            );
          }
        );
    }


    // ------------------------------------------------------------
    // Camera
    // ------------------------------------------------------------

    if (this.elements.btnToggleCam) {

      this.elements.btnToggleCam
        .addEventListener(
          'click',
          () => {

            this.isVideoMuted =
              !this.isVideoMuted;

            webrtc.toggleVideo(
              !this.isVideoMuted
            );

            this.elements.btnToggleCam
              .classList
              .toggle(
                'off',
                this.isVideoMuted
              );

            this.elements.btnToggleCam.innerHTML =
              this.isVideoMuted
                ? '🚫'
                : '📹';

            Utils.showToast(
              this.isVideoMuted
                ? 'Camera disabled'
                : 'Camera enabled',
              'info'
            );
          }
        );
    }


    // ------------------------------------------------------------
    // Switch Camera
    // ------------------------------------------------------------

    if (this.elements.btnSwitchCam) {

      this.elements.btnSwitchCam
        .addEventListener(
          'click',
          async () => {

            const result =
              await webrtc.switchCamera();

            if (result) {

              Utils.showToast(
                'Camera switched',
                'info'
              );
            }
          }
        );
    }


    // ------------------------------------------------------------
    // End Call
    // ------------------------------------------------------------

    if (this.elements.btnEndCall) {

      this.elements.btnEndCall
        .addEventListener(
          'click',
          () => {
            this.endCall(true);
          }
        );
    }
  },


  // ==============================================================
  // START OUTGOING CALL
  // ==============================================================

  async startCall(
    peerUser,
    callType = 'video'
  ) {

    if (!peerUser) {
      return;
    }


    if (this.activeCall) {

      Utils.showToast(
        'You are already in a call',
        'warning'
      );

      return;
    }


    console.log(
      '[Calls] Starting outgoing call:',
      peerUser,
      callType
    );


    this.activeCall = {

      peerId:
        peerUser.id,

      peerName:
        peerUser.display_name ||
        peerUser.username ||
        'Contact',

      peerAvatar:
        peerUser.avatar_url,

      callType:
        callType,

      role:
        'caller',

      state:
        'calling'
    };


    try {

      // ----------------------------------------------------------
      // Acquire local media
      // ----------------------------------------------------------

      const localStream =
        await webrtc.getMediaStream(
          callType
        );


      // ----------------------------------------------------------
      // Attach local video
      // ----------------------------------------------------------

      if (
        this.elements.localVideo &&
        callType === 'video'
      ) {

        this.elements.localVideo.srcObject =
          localStream;

        this.elements.localVideo.muted =
          true;

        this.elements.localVideo.autoplay =
          true;

        this.elements.localVideo.playsInline =
          true;

        this.elements.localVideo.play()
          .catch(error => {
            console.warn(
              '[Calls] Local video playback blocked:',
              error
            );
          });
      }


      // ----------------------------------------------------------
      // Show call modal
      // ----------------------------------------------------------

      this.showCallModal(
        this.activeCall
      );

      this.updateCallStatus(
        'Calling...'
      );


      // ----------------------------------------------------------
      // Play ringback
      // ----------------------------------------------------------

      this.playRingtone(
        'outgoing'
      );


      // ----------------------------------------------------------
      // Send call invite
      // ----------------------------------------------------------

      console.log(
        '[Calls] Sending call_invite'
      );

      WSClient.send(
        'call_invite',
        {
          target_user_id:
            peerUser.id,

          call_type:
            callType
        }
      );

    } catch (error) {

      console.error(
        '[Calls] Failed to start call:',
        error
      );

      Utils.showToast(
        error.message ||
        'Unable to start call',
        'error'
      );

      this.endCall(false);
    }
  },


  // ==============================================================
  // HANDLE INCOMING CALL
  // ==============================================================

  handleIncomingInvite(data) {

    if (!data) {
      return;
    }


    if (this.activeCall) {

      console.warn(
        '[Calls] Already in another call'
      );

      WSClient.send(
        'call_reject',
        {
          target_user_id:
            data.caller_id,

          reason:
            'busy'
        }
      );

      return;
    }


    console.log(
      '[Calls] Handling incoming call'
    );


    this.activeCall = {

      peerId:
        data.caller_id,

      peerName:
        data.caller_name ||
        'Contact',

      peerAvatar:
        data.caller_avatar,

      callType:
        data.call_type ||
        'audio',

      role:
        'callee',

      state:
        'incoming'
    };


    // ------------------------------------------------------------
    // Render incoming caller
    // ------------------------------------------------------------

    const avatar =
      API.resolveUrl(
        data.caller_avatar
      ) ||
      `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
        data.caller_name || 'Contact'
      )}`;


    if (this.elements.incomingAvatar) {

      this.elements.incomingAvatar.src =
        avatar;
    }


    if (this.elements.incomingName) {

      this.elements.incomingName.textContent =
        data.caller_name ||
        'Contact';
    }


    if (this.elements.incomingType) {

      this.elements.incomingType.textContent =
        `Incoming ${
          data.call_type === 'video'
            ? 'Video'
            : 'Voice'
        } Call...`;
    }


    if (this.elements.incomingOverlay) {

      this.elements.incomingOverlay
        .classList
        .add('active');
    }


    this.playRingtone(
      'incoming'
    );
  },


  // ==============================================================
  // ACCEPT INCOMING CALL
  // ==============================================================

  async acceptIncomingCall() {

    console.log(
      '[Calls] Accepting incoming call'
    );


    this.stopRingtone();


    if (this.elements.incomingOverlay) {

      this.elements.incomingOverlay
        .classList
        .remove('active');
    }


    if (!this.activeCall) {

      console.warn(
        '[Calls] No active incoming call'
      );

      return;
    }


    try {

      // ----------------------------------------------------------
      // Get local media
      // ----------------------------------------------------------

      const localStream =
        await webrtc.getMediaStream(
          this.activeCall.callType
        );


      // ----------------------------------------------------------
      // Local video
      // ----------------------------------------------------------

      if (
        this.elements.localVideo &&
        this.activeCall.callType === 'video'
      ) {

        this.elements.localVideo.srcObject =
          localStream;

        this.elements.localVideo.muted =
          true;

        this.elements.localVideo.autoplay =
          true;

        this.elements.localVideo.playsInline =
          true;

        this.elements.localVideo.play()
          .catch(error => {

            console.warn(
              '[Calls] Local video playback blocked:',
              error
            );
          });
      }


      // ----------------------------------------------------------
      // Show modal
      // ----------------------------------------------------------

      this.showCallModal(
        this.activeCall
      );

      this.updateCallStatus(
        'Connecting...'
      );


      // ----------------------------------------------------------
      // Tell caller we accepted
      // ----------------------------------------------------------

      console.log(
        '[Calls] Sending call_accept'
      );

      WSClient.send(
        'call_accept',
        {
          target_user_id:
            this.activeCall.peerId,

          call_type:
            this.activeCall.callType
        }
      );

    } catch (error) {

      console.error(
        '[Calls] Failed to accept call:',
        error
      );

      Utils.showToast(
        error.message ||
        'Unable to accept call',
        'error'
      );

      this.declineIncomingCall();
    }
  },


  // ==============================================================
  // DECLINE INCOMING CALL
  // ==============================================================

  declineIncomingCall() {

    console.log(
      '[Calls] Declining incoming call'
    );


    this.stopRingtone();


    if (this.elements.incomingOverlay) {

      this.elements.incomingOverlay
        .classList
        .remove('active');
    }


    if (this.activeCall) {

      WSClient.send(
        'call_reject',
        {
          target_user_id:
            this.activeCall.peerId,

          reason:
            'declined'
        }
      );
    }


    this.endCall(false);
  },


  // ==============================================================
  // CALL ACCEPTED BY CALLEE
  // ==============================================================

  async handleCallAccepted(data) {

    console.log(
      '[Calls] Callee accepted call'
    );


    this.stopRingtone();


    if (!this.activeCall) {

      console.warn(
        '[Calls] No active call when call_accept arrived'
      );

      return;
    }


    this.updateCallStatus(
      'Connecting...'
    );


    try {

      // ----------------------------------------------------------
      // Create WebRTC offer
      // ----------------------------------------------------------

      console.log(
        '[Calls] Creating WebRTC offer'
      );

      const offer =
        await webrtc.createOffer();


      console.log(
        '[Calls] Sending WebRTC offer'
      );


      WSClient.send(
        'webrtc_offer',
        {
          target_user_id:
            this.activeCall.peerId,

          offer:
            offer
        }
      );

    } catch (error) {

      console.error(
        '[Calls] Failed to create offer:',
        error
      );

      Utils.showToast(
        'Failed to create call connection.',
        'error'
      );

      this.endCall(true);
    }
  },


  // ==============================================================
  // CALL REJECTED
  // ==============================================================

  handleCallRejected(data) {

    this.stopRingtone();


    const reasonMsg =
      data?.reason === 'busy'
        ? 'User is busy on another call.'
        : (
            data?.message ||
            'Call was declined.'
          );


    Utils.showToast(
      reasonMsg,
      'info'
    );


    this.endCall(false);
  },


  // ==============================================================
  // RECEIVE WEBRTC OFFER
  // ==============================================================

  async handleWebRtcOffer(data) {

    console.log(
      '[Calls] Handling WebRTC offer'
    );


    if (!this.activeCall) {

      console.error(
        '[Calls] Received offer without active call'
      );

      return;
    }


    try {

      this.updateCallStatus(
        'Connecting...'
      );


      const answer =
        await webrtc
          .handleOfferAndCreateAnswer(
            data.offer
          );


      console.log(
        '[Calls] Sending WebRTC answer'
      );


      WSClient.send(
        'webrtc_answer',
        {
          target_user_id:
            this.activeCall.peerId,

          answer:
            answer
        }
      );


      // Do NOT start the timer here.
      // Timer starts when WebRTC actually connects.

    } catch (error) {

      console.error(
        '[Calls] Error handling WebRTC offer:',
        error
      );

      Utils.showToast(
        'Failed to establish call connection.',
        'error'
      );

      this.endCall(true);
    }
  },


  // ==============================================================
  // RECEIVE WEBRTC ANSWER
  // ==============================================================

  async handleWebRtcAnswer(data) {

    console.log(
      '[Calls] Handling WebRTC answer'
    );


    if (!this.activeCall) {

      console.error(
        '[Calls] Received answer without active call'
      );

      return;
    }


    try {

      await webrtc.handleAnswer(
        data.answer
      );


      console.log(
        '[Calls] Remote answer applied successfully'
      );


      // Do NOT start timer here.
      // Wait for connection state = connected.

    } catch (error) {

      console.error(
        '[Calls] Error handling WebRTC answer:',
        error
      );

      Utils.showToast(
        'Failed to complete call connection.',
        'error'
      );
    }
  },


  // ==============================================================
  // END CALL
  // ==============================================================

  endCall(notifyPeer = true) {

    console.log(
      '[Calls] Ending call'
    );


    this.stopRingtone();

    this.stopDurationTimer();


    // ------------------------------------------------------------
    // Notify peer
    // ------------------------------------------------------------

    if (
      this.activeCall &&
      notifyPeer
    ) {

      try {

        WSClient.send(
          'call_end',
          {
            target_user_id:
              this.activeCall.peerId
          }
        );

      } catch (error) {

        console.warn(
          '[Calls] Failed to notify peer:',
          error
        );
      }
    }


    // ------------------------------------------------------------
    // Cleanup WebRTC
    // ------------------------------------------------------------

    webrtc.cleanup();


    // ------------------------------------------------------------
    // Clear remote video
    // ------------------------------------------------------------

    if (this.elements.remoteVideo) {

      this.elements.remoteVideo.pause();

      this.elements.remoteVideo.srcObject =
        null;
    }


    // ------------------------------------------------------------
    // Clear remote audio
    // ------------------------------------------------------------

    if (this.elements.remoteAudio) {

      this.elements.remoteAudio.pause();

      this.elements.remoteAudio.srcObject =
        null;
    }


    // ------------------------------------------------------------
    // Clear local video
    // ------------------------------------------------------------

    if (this.elements.localVideo) {

      this.elements.localVideo.pause();

      this.elements.localVideo.srcObject =
        null;
    }


    // ------------------------------------------------------------
    // Hide call modal
    // ------------------------------------------------------------

    if (this.elements.callModal) {

      this.elements.callModal
        .classList
        .remove('active');
    }


    // ------------------------------------------------------------
    // Hide incoming overlay
    // ------------------------------------------------------------

    if (this.elements.incomingOverlay) {

      this.elements.incomingOverlay
        .classList
        .remove('active');
    }


    // ------------------------------------------------------------
    // Reset state
    // ------------------------------------------------------------

    this.activeCall =
      null;

    this.isAudioMuted =
      false;

    this.isVideoMuted =
      false;


    // ------------------------------------------------------------
    // Reset microphone button
    // ------------------------------------------------------------

    if (this.elements.btnMuteMic) {

      this.elements.btnMuteMic
        .classList
        .remove('muted');

      this.elements.btnMuteMic.innerHTML =
        '🎤';
    }


    // ------------------------------------------------------------
    // Reset camera button
    // ------------------------------------------------------------

    if (this.elements.btnToggleCam) {

      this.elements.btnToggleCam
        .classList
        .remove('off');

      this.elements.btnToggleCam.innerHTML =
        '📹';
    }


    console.log(
      '[Calls] Call cleanup complete'
    );
  },


  // ==============================================================
  // SHOW CALL MODAL
  // ==============================================================

  showCallModal(callInfo) {

    if (!callInfo) {
      return;
    }


    const isVideo =
      callInfo.callType === 'video';


    const avatar =
      API.resolveUrl(
        callInfo.peerAvatar
      ) ||
      `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
        callInfo.peerName || 'Contact'
      )}`;


    if (this.elements.peerName) {

      this.elements.peerName.textContent =
        callInfo.peerName ||
        'Contact';
    }


    if (this.elements.voiceAvatar) {

      this.elements.voiceAvatar.src =
        avatar;
    }


    // ------------------------------------------------------------
    // Prepare remote audio
    // ------------------------------------------------------------

    if (this.elements.remoteAudio) {

      this.elements.remoteAudio.autoplay =
        true;

      this.elements.remoteAudio.playsInline =
        true;

      this.elements.remoteAudio.muted =
        false;

      this.elements.remoteAudio.volume =
        1.0;
    }


    // ------------------------------------------------------------
    // Prepare remote video
    // ------------------------------------------------------------

    if (this.elements.remoteVideo) {

      this.elements.remoteVideo.autoplay =
        true;

      this.elements.remoteVideo.playsInline =
        true;

      this.elements.remoteVideo.muted =
        false;
    }


    // ------------------------------------------------------------
    // Prepare local video
    // ------------------------------------------------------------

    if (this.elements.localVideo) {

      this.elements.localVideo.autoplay =
        true;

      this.elements.localVideo.playsInline =
        true;

      // Local preview MUST be muted.
      this.elements.localVideo.muted =
        true;
    }


    // ------------------------------------------------------------
    // VIDEO MODE
    // ------------------------------------------------------------

    if (isVideo) {

      if (this.elements.videoStage) {

        this.elements.videoStage
          .classList
          .remove('hidden');
      }


      if (this.elements.voiceStage) {

        this.elements.voiceStage
          .classList
          .add('hidden');
      }


      if (this.elements.btnToggleCam) {

        this.elements.btnToggleCam
          .classList
          .remove('hidden');
      }


      if (this.elements.btnSwitchCam) {

        this.elements.btnSwitchCam
          .classList
          .remove('hidden');
      }

    }

    // ------------------------------------------------------------
    // VOICE MODE
    // ------------------------------------------------------------

    else {

      if (this.elements.videoStage) {

        this.elements.videoStage
          .classList
          .add('hidden');
      }


      if (this.elements.voiceStage) {

        this.elements.voiceStage
          .classList
          .remove('hidden');
      }


      if (this.elements.btnToggleCam) {

        this.elements.btnToggleCam
          .classList
          .add('hidden');
      }


      if (this.elements.btnSwitchCam) {

        this.elements.btnSwitchCam
          .classList
          .add('hidden');
      }
    }


    // ------------------------------------------------------------
    // Show modal
    // ------------------------------------------------------------

    if (this.elements.callModal) {

      this.elements.callModal
        .classList
        .add('active');
    }
  },


  // ==============================================================
  // UPDATE CALL STATUS
  // ==============================================================

  updateCallStatus(text) {

    if (this.elements.callTimerEl) {

      this.elements.callTimerEl.textContent =
        text;
    }
  },


  // ==============================================================
  // CALL DURATION TIMER
  // ==============================================================

  startDurationTimer() {

    // Don't create duplicate timers.
    if (this.callTimer) {
      return;
    }


    this.callSeconds =
      0;


    this.updateCallStatus(
      '00:00'
    );


    this.callTimer =
      setInterval(
        () => {

          this.callSeconds++;


          const mins =
            String(
              Math.floor(
                this.callSeconds / 60
              )
            ).padStart(
              2,
              '0'
            );


          const secs =
            String(
              this.callSeconds % 60
            ).padStart(
              2,
              '0'
            );


          this.updateCallStatus(
            `${mins}:${secs}`
          );

        },
        1000
      );
  },


  // ==============================================================
  // STOP CALL TIMER
  // ==============================================================

  stopDurationTimer() {

    if (this.callTimer) {

      clearInterval(
        this.callTimer
      );

      this.callTimer =
        null;
    }


    this.callSeconds =
      0;
  },


  // ==============================================================
  // REMOTE AUDIO AUTOPLAY RETRY
  // ==============================================================

  enableAudioPlaybackRetry() {

    const audio =
      this.elements.remoteAudio;


    if (!audio) {
      return;
    }


    const tryPlay =
      () => {

        if (
          !audio.srcObject
        ) {
          return;
        }


        audio.muted =
          false;

        audio.volume =
          1.0;


        audio.play()
          .then(() => {

            console.log(
              '[Calls] Remote audio playback started after user interaction'
            );

          })
          .catch(error => {

            console.warn(
              '[Calls] Audio playback still blocked:',
              error
            );
          });
      };


    document.addEventListener(
      'click',
      tryPlay,
      {
        once: true
      }
    );


    document.addEventListener(
      'touchstart',
      tryPlay,
      {
        once: true
      }
    );


    document.addEventListener(
      'keydown',
      tryPlay,
      {
        once: true
      }
    );
  },


  // ==============================================================
  // RINGTONE
  // ==============================================================

  playRingtone(
    type = 'incoming'
  ) {

    this.stopRingtone();


    try {

      Notifications.initAudio();

    } catch (error) {

      console.warn(
        '[Calls] Notification audio initialization failed:',
        error
      );
    }


    const playTone =
      () => {

        if (
          !Notifications.audioContext
        ) {
          return;
        }


        const ctx =
          Notifications.audioContext;


        const now =
          ctx.currentTime;


        const oscillator =
          ctx.createOscillator();


        const gain =
          ctx.createGain();


        oscillator.type =
          'sine';


        if (type === 'incoming') {

          oscillator.frequency
            .setValueAtTime(
              440,
              now
            );


          oscillator.frequency
            .exponentialRampToValueAtTime(
              880,
              now + 0.3
            );

        } else {

          oscillator.frequency
            .setValueAtTime(
              440,
              now
            );
        }


        gain.gain
          .setValueAtTime(
            0.12,
            now
          );


        gain.gain
          .exponentialRampToValueAtTime(
            0.001,
            now + 0.6
          );


        oscillator.connect(
          gain
        );


        gain.connect(
          ctx.destination
        );


        oscillator.start(
          now
        );


        oscillator.stop(
          now + 0.6
        );
      };


    playTone();


    this.ringtoneInterval =
      setInterval(
        playTone,
        type === 'incoming'
          ? 2000
          : 3500
      );
  },


  // ==============================================================
  // STOP RINGTONE
  // ==============================================================

  stopRingtone() {

    if (this.ringtoneInterval) {

      clearInterval(
        this.ringtoneInterval
      );

      this.ringtoneInterval =
        null;
    }
  }
};


// ================================================================
// EXPORT / GLOBAL
// ================================================================

window.Calls = Calls;
