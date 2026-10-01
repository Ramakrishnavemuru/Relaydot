// ============================================================
// Relay — Real-Time Call Controller
// Voice & Video Calls
// ============================================================

const Calls = {

  // ==========================================================
  // STATE
  // ==========================================================

  activeCall: null,

  callTimer: null,

  callSeconds: 0,

  ringtoneInterval: null,

  isAudioMuted: false,

  isVideoMuted: false,

  // UI Elements cache
  elements: {},


  // ==========================================================
  // INITIALIZATION
  // ==========================================================

  init() {

    console.log('[Calls] Initializing call controller...');


    this.elements = {

      // --------------------------------------------------------
      // Incoming Call Banner
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // Call Modal
      // --------------------------------------------------------

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

      // NEW:
      // Dedicated remote audio element
      remoteAudio:
        Utils.$('#remote-audio-el'),


      // --------------------------------------------------------
      // Call Controls
      // --------------------------------------------------------

      btnMuteMic:
        Utils.$('#btn-call-mute-mic'),

      btnToggleCam:
        Utils.$('#btn-call-toggle-cam'),

      btnSwitchCam:
        Utils.$('#btn-call-switch-cam'),

      btnEndCall:
        Utils.$('#btn-call-end')
    };


    // ----------------------------------------------------------
    // Load WebRTC configuration
    // ----------------------------------------------------------

    webrtc.initConfig();


    // ----------------------------------------------------------
    // Bind signaling events
    // ----------------------------------------------------------

    this.bindSocketEvents();


    // ----------------------------------------------------------
    // Bind UI
    // ----------------------------------------------------------

    this.bindUI();


    // ----------------------------------------------------------
    // WebRTC remote stream callback
    // ----------------------------------------------------------

    this.setupWebRTCCallbacks();


    console.log(
      '[Calls] Call controller initialized.'
    );
  },


  // ==========================================================
  // WEBRTC CALLBACKS
  // ==========================================================

  setupWebRTCCallbacks() {

    // --------------------------------------------------------
    // Remote media stream
    // --------------------------------------------------------

    webrtc.onRemoteStreamCallback =
      async (remoteStream) => {

        console.log(
          '[Calls] Remote stream received:',
          {
            audioTracks:
              remoteStream.getAudioTracks().length,

            videoTracks:
              remoteStream.getVideoTracks().length
          }
        );


        // ====================================================
        // REMOTE VIDEO
        // ====================================================

        if (this.elements.remoteVideo) {

          const videoTracks =
            remoteStream.getVideoTracks();


          if (videoTracks.length > 0) {

            console.log(
              '[Calls] Attaching remote stream to video element.'
            );


            this.elements.remoteVideo.srcObject =
              remoteStream;


            this.elements.remoteVideo.muted =
              false;


            try {

              await this.elements.remoteVideo.play();

              console.log(
                '[Calls] Remote video playback started.'
              );

            } catch (err) {

              console.warn(
                '[Calls] Remote video autoplay failed:',
                err
              );

            }

          } else {

            console.log(
              '[Calls] Remote stream currently has no video track.'
            );
          }
        }


        // ====================================================
        // REMOTE AUDIO
        // ====================================================

        if (this.elements.remoteAudio) {

          const audioTracks =
            remoteStream.getAudioTracks();


          if (audioTracks.length > 0) {

            console.log(
              '[Calls] Attaching remote stream to audio element.'
            );


            this.elements.remoteAudio.srcObject =
              remoteStream;


            // Make sure remote audio isn't muted.
            this.elements.remoteAudio.muted =
              false;


            this.elements.remoteAudio.volume =
              1.0;


            try {

              await this.elements.remoteAudio.play();

              console.log(
                '[Calls] Remote audio playback started.'
              );

            } catch (err) {

              console.warn(
                '[Calls] Remote audio autoplay failed:',
                err
              );


              // ------------------------------------------------
              // Browser autoplay can block playback.
              // Since the call was initiated through a user
              // action, retry on next interaction.
              // ------------------------------------------------

              this.enableAudioPlaybackRetry();

            }

          } else {

            console.log(
              '[Calls] Remote stream currently has no audio track.'
            );
          }
        }


        // ------------------------------------------------------
        // Debug information
        // ------------------------------------------------------

        console.log(
          '[Calls] Remote audio tracks:',
          remoteStream
            .getAudioTracks()
            .map(track => ({
              id: track.id,
              label: track.label,
              enabled: track.enabled,
              muted: track.muted,
              readyState: track.readyState
            }))
        );


        console.log(
          '[Calls] Remote video tracks:',
          remoteStream
            .getVideoTracks()
            .map(track => ({
              id: track.id,
              label: track.label,
              enabled: track.enabled,
              muted: track.muted,
              readyState: track.readyState
            }))
        );
      };


    // --------------------------------------------------------
    // Local ICE candidate
    // --------------------------------------------------------

    webrtc.onIceCandidateCallback =
      (candidate) => {

        if (!this.activeCall) {

          console.warn(
            '[Calls] Cannot send ICE candidate: no active call.'
          );

          return;
        }


        console.log(
          '[Calls] Sending ICE candidate to peer.'
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


    // --------------------------------------------------------
    // WebRTC connection state
    // --------------------------------------------------------

    webrtc.onConnectionStateChangeCallback =
      (state) => {

        console.log(
          '[Calls] WebRTC connection state:',
          state
        );


        switch (state) {

          case 'connected':

            this.stopRingtone();

            this.updateCallStatus(
              'Connected'
            );

            console.log(
              '[Calls] WebRTC connection established.'
            );

            break;


          case 'connecting':

            this.updateCallStatus(
              'Connecting...'
            );

            break;


          case 'disconnected':

            console.warn(
              '[Calls] WebRTC connection disconnected.'
            );

            this.updateCallStatus(
              'Connection interrupted...'
            );

            break;


          case 'failed':

            console.error(
              '[Calls] WebRTC connection failed.'
            );

            this.updateCallStatus(
              'Connection failed'
            );

            Utils.showToast(
              'Unable to establish the call connection.',
              'error'
            );

            break;


          case 'closed':

            console.log(
              '[Calls] WebRTC connection closed.'
            );

            break;
        }
      };


    // --------------------------------------------------------
    // ICE connection state
    // --------------------------------------------------------

    webrtc.onIceConnectionStateChangeCallback =
      (state) => {

        console.log(
          '[Calls] ICE connection state:',
          state
        );


        if (state === 'connected' ||
            state === 'completed') {

          console.log(
            '[Calls] ICE connection established.'
          );

        }


        if (state === 'checking') {

          this.updateCallStatus(
            'Connecting...'
          );

        }


        if (state === 'failed') {

          console.error(
            '[Calls] ICE connection failed. TURN may be required.'
          );

        }
      };


    // --------------------------------------------------------
    // ICE gathering state
    // --------------------------------------------------------

    webrtc.onIceGatheringStateChangeCallback =
      (state) => {

        console.log(
          '[Calls] ICE gathering state:',
          state
        );
      };
  },


  // ==========================================================
  // AUTOPLAY RETRY
  // ==========================================================

  enableAudioPlaybackRetry() {

    const retryPlayback =
      async () => {

        if (
          !this.elements.remoteAudio ||
          !this.elements.remoteAudio.srcObject
        ) {

          return;
        }


        try {

          await this.elements.remoteAudio.play();

          console.log(
            '[Calls] Remote audio playback started after retry.'
          );


          document.removeEventListener(
            'click',
            retryPlayback
          );


          document.removeEventListener(
            'touchstart',
            retryPlayback
          );


          document.removeEventListener(
            'keydown',
            retryPlayback
          );

        } catch (err) {

          console.warn(
            '[Calls] Audio playback retry failed:',
            err
          );

        }
      };


    document.addEventListener(
      'click',
      retryPlayback,
      {
        once: true
      }
    );


    document.addEventListener(
      'touchstart',
      retryPlayback,
      {
        once: true
      }
    );


    document.addEventListener(
      'keydown',
      retryPlayback,
      {
        once: true
      }
    );
  },


  // ==========================================================
  // SOCKET EVENTS
  // ==========================================================

  bindSocketEvents() {

    // --------------------------------------------------------
    // Incoming Call Invite
    // --------------------------------------------------------

    WSClient.on(
      'call_invite',
      (data) => {

        console.log(
          '[Calls] Incoming call invite:',
          data
        );


        this.handleIncomingInvite(
          data
        );
      }
    );


    // --------------------------------------------------------
    // Call Accepted
    // --------------------------------------------------------

    WSClient.on(
      'call_accept',
      async (data) => {

        console.log(
          '[Calls] Call accepted:',
          data
        );


        await this.handleCallAccepted(
          data
        );
      }
    );


    // --------------------------------------------------------
    // Call Rejected
    // --------------------------------------------------------

    WSClient.on(
      'call_reject',
      (data) => {

        console.log(
          '[Calls] Call rejected:',
          data
        );


        this.handleCallRejected(
          data
        );
      }
    );


    // --------------------------------------------------------
    // WebRTC Offer
    // --------------------------------------------------------

    WSClient.on(
      'webrtc_offer',
      async (data) => {

        console.log(
          '[Calls] WebRTC offer received.'
        );


        await this.handleWebRtcOffer(
          data
        );
      }
    );


    // --------------------------------------------------------
    // WebRTC Answer
    // --------------------------------------------------------

    WSClient.on(
      'webrtc_answer',
      async (data) => {

        console.log(
          '[Calls] WebRTC answer received.'
        );


        await this.handleWebRtcAnswer(
          data
        );
      }
    );


    // --------------------------------------------------------
    // ICE Candidate
    // --------------------------------------------------------

    WSClient.on(
      'ice_candidate',
      async (data) => {

        if (!data || !data.candidate) {

          console.warn(
            '[Calls] Received ICE event without candidate.'
          );

          return;
        }


        console.log(
          '[Calls] Remote ICE candidate received.'
        );


        await webrtc.addIceCandidate(
          data.candidate
        );
      }
    );


    // --------------------------------------------------------
    // Call End
    // --------------------------------------------------------

    WSClient.on(
      'call_end',
      () => {

        console.log(
          '[Calls] Peer ended the call.'
        );


        Utils.showToast(
          'Call ended by peer',
          'info'
        );


        this.endCall(
          false
        );
      }
    );
  },


  // ==========================================================
  // UI EVENTS
  // ==========================================================

  bindUI() {

    // --------------------------------------------------------
    // Accept
    // --------------------------------------------------------

    if (this.elements.btnAccept) {

      this.elements.btnAccept.addEventListener(
        'click',
        () => {

          this.acceptIncomingCall();

        }
      );
    }


    // --------------------------------------------------------
    // Decline
    // --------------------------------------------------------

    if (this.elements.btnDecline) {

      this.elements.btnDecline.addEventListener(
        'click',
        () => {

          this.declineIncomingCall();

        }
      );
    }


    // --------------------------------------------------------
    // Microphone
    // --------------------------------------------------------

    if (this.elements.btnMuteMic) {

      this.elements.btnMuteMic.addEventListener(
        'click',
        () => {

          this.isAudioMuted =
            !this.isAudioMuted;


          webrtc.toggleAudio(
            !this.isAudioMuted
          );


          this.elements.btnMuteMic
            .classList.toggle(
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


    // --------------------------------------------------------
    // Camera
    // --------------------------------------------------------

    if (this.elements.btnToggleCam) {

      this.elements.btnToggleCam.addEventListener(
        'click',
        () => {

          this.isVideoMuted =
            !this.isVideoMuted;


          webrtc.toggleVideo(
            !this.isVideoMuted
          );


          this.elements.btnToggleCam
            .classList.toggle(
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


    // --------------------------------------------------------
    // Switch Camera
    // --------------------------------------------------------

    if (this.elements.btnSwitchCam) {

      this.elements.btnSwitchCam.addEventListener(
        'click',
        async () => {

          const track =
            await webrtc.switchCamera();


          if (track) {

            // Update local preview
            if (
              this.elements.localVideo
            ) {

              this.elements.localVideo.srcObject =
                webrtc.localStream;


              try {

                await this.elements.localVideo.play();

              } catch (e) {

                console.warn(
                  '[Calls] Local video playback failed:',
                  e
                );

              }
            }


            Utils.showToast(
              'Camera switched',
              'info'
            );

          } else {

            Utils.showToast(
              'Unable to switch camera',
              'warning'
            );
          }
        }
      );
    }


    // --------------------------------------------------------
    // End Call
    // --------------------------------------------------------

    if (this.elements.btnEndCall) {

      this.elements.btnEndCall.addEventListener(
        'click',
        () => {

          this.endCall(
            true
          );

        }
      );
    }
  },


  // ==========================================================
  // START OUTGOING CALL
  // ==========================================================

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
      {
        peerId: peerUser.id,
        callType
      }
    );


    this.activeCall = {

      peerId:
        peerUser.id,

      peerName:
        peerUser.display_name ||
        peerUser.username,

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

      // ------------------------------------------------------
      // Acquire local media
      // ------------------------------------------------------

      const localStream =
        await webrtc.getMediaStream(
          callType
        );


      // ------------------------------------------------------
      // Local video preview
      // ------------------------------------------------------

      if (
        this.elements.localVideo &&
        callType === 'video'
      ) {

        this.elements.localVideo.srcObject =
          localStream;


        try {

          await this.elements.localVideo.play();

        } catch (e) {

          console.warn(
            '[Calls] Local video autoplay failed:',
            e
          );

        }
      }


      // ------------------------------------------------------
      // Open call modal
      // ------------------------------------------------------

      this.showCallModal(
        this.activeCall
      );


      this.updateCallStatus(
        'Calling...'
      );


      // ------------------------------------------------------
      // Ringtone
      // ------------------------------------------------------

      this.playRingtone(
        'outgoing'
      );


      // ------------------------------------------------------
      // Send call invitation
      // ------------------------------------------------------

      console.log(
        '[Calls] Sending call invite.'
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


    } catch (err) {

      console.error(
        '[Calls] Failed to start call:',
        err
      );


      Utils.showToast(
        err.message ||
        'Unable to start call',
        'error'
      );


      this.endCall(
        false
      );
    }
  },


  // ==========================================================
  // HANDLE INCOMING INVITE
  // ==========================================================

  handleIncomingInvite(data) {

    if (!data) {

      return;
    }


    // --------------------------------------------------------
    // Busy
    // --------------------------------------------------------

    if (this.activeCall) {

      console.log(
        '[Calls] Already in a call. Rejecting incoming call.'
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


    // --------------------------------------------------------
    // Create active call
    // --------------------------------------------------------

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


    console.log(
      '[Calls] Incoming call:',
      this.activeCall
    );


    // --------------------------------------------------------
    // Incoming avatar
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // Show incoming overlay
    // --------------------------------------------------------

    if (this.elements.incomingOverlay) {

      this.elements.incomingOverlay
        .classList.add(
          'active'
        );
    }


    this.playRingtone(
      'incoming'
    );
  },


  // ==========================================================
  // ACCEPT INCOMING CALL
  // ==========================================================

  async acceptIncomingCall() {

    this.stopRingtone();


    if (this.elements.incomingOverlay) {

      this.elements.incomingOverlay
        .classList.remove(
          'active'
        );
    }


    if (!this.activeCall) {

      return;
    }


    console.log(
      '[Calls] Accepting incoming call:',
      this.activeCall
    );


    try {

      // ------------------------------------------------------
      // Acquire local stream
      // ------------------------------------------------------

      const localStream =
        await webrtc.getMediaStream(
          this.activeCall.callType
        );


      // ------------------------------------------------------
      // Local video
      // ------------------------------------------------------

      if (
        this.elements.localVideo &&
        this.activeCall.callType === 'video'
      ) {

        this.elements.localVideo.srcObject =
          localStream;


        try {

          await this.elements.localVideo.play();

        } catch (e) {

          console.warn(
            '[Calls] Local video playback failed:',
            e
          );

        }
      }


      // ------------------------------------------------------
      // Show modal
      // ------------------------------------------------------

      this.showCallModal(
        this.activeCall
      );


      this.updateCallStatus(
        'Connecting...'
      );


      // ------------------------------------------------------
      // Notify caller
      // ------------------------------------------------------

      console.log(
        '[Calls] Sending call_accept.'
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


    } catch (err) {

      console.error(
        '[Calls] Failed to accept call:',
        err
      );


      Utils.showToast(
        err.message ||
        'Unable to accept call',
        'error'
      );


      this.declineIncomingCall();
    }
  },


  // ==========================================================
  // DECLINE INCOMING CALL
  // ==========================================================

  declineIncomingCall() {

    this.stopRingtone();


    if (this.elements.incomingOverlay) {

      this.elements.incomingOverlay
        .classList.remove(
          'active'
        );
    }


    if (this.activeCall) {

      console.log(
        '[Calls] Declining incoming call.'
      );


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


    this.endCall(
      false
    );
  },


  // ==========================================================
  // CALL ACCEPTED BY CALLEE
  // ==========================================================

  async handleCallAccepted(data) {

    this.stopRingtone();


    this.updateCallStatus(
      'Connecting...'
    );


    if (!this.activeCall) {

      console.warn(
        '[Calls] Call accepted but no active call exists.'
      );

      return;
    }


    try {

      console.log(
        '[Calls] Creating SDP offer.'
      );


      const offer =
        await webrtc.createOffer();


      console.log(
        '[Calls] Sending WebRTC offer.'
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


    } catch (err) {

      console.error(
        '[Calls] Failed to create offer:',
        err
      );


      Utils.showToast(
        'Failed to establish call',
        'error'
      );


      this.endCall(
        true
      );
    }
  },


  // ==========================================================
  // CALL REJECTED
  // ==========================================================

  handleCallRejected(data) {

    this.stopRingtone();


    const reasonMsg =
      data &&
      data.reason === 'busy'
        ? 'User is busy on another call.'
        : (
            data &&
            (
              data.message ||
              'Call was declined.'
            )
          );


    Utils.showToast(
      reasonMsg,
      'info'
    );


    this.endCall(
      false
    );
  },


  // ==========================================================
  // HANDLE WEBRTC OFFER
  // ==========================================================

  async handleWebRtcOffer(data) {

    if (!this.activeCall) {

      console.warn(
        '[Calls] Received WebRTC offer without active call.'
      );

      return;
    }


    if (!data || !data.offer) {

      console.error(
        '[Calls] WebRTC offer payload is missing.'
      );

      return;
    }


    try {

      console.log(
        '[Calls] Handling WebRTC offer.'
      );


      const answer =
        await webrtc.handleOfferAndCreateAnswer(
          data.offer
        );


      console.log(
        '[Calls] Sending WebRTC answer.'
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


      // ------------------------------------------------------
      // Answer sent. Connection establishment can now begin.
      // ------------------------------------------------------

      this.updateCallStatus(
        'Connecting...'
      );


    } catch (err) {

      console.error(
        '[Calls] Error handling WebRTC offer:',
        err
      );


      Utils.showToast(
        'Failed to establish incoming call',
        'error'
      );


      this.endCall(
        true
      );
    }
  },


  // ==========================================================
  // HANDLE WEBRTC ANSWER
  // ==========================================================

  async handleWebRtcAnswer(data) {

    if (!this.activeCall) {

      console.warn(
        '[Calls] Received WebRTC answer without active call.'
      );

      return;
    }


    if (!data || !data.answer) {

      console.error(
        '[Calls] WebRTC answer payload is missing.'
      );

      return;
    }


    try {

      console.log(
        '[Calls] Handling WebRTC answer.'
      );


      await webrtc.handleAnswer(
        data.answer
      );


      this.updateCallStatus(
        'Connecting...'
      );


    } catch (err) {

      console.error(
        '[Calls] Error handling WebRTC answer:',
        err
      );


      Utils.showToast(
        'Failed to establish call',
        'error'
      );
    }
  },


  // ==========================================================
  // END CALL
  // ==========================================================

  endCall(
    notifyPeer = true
  ) {

    console.log(
      '[Calls] Ending call.',
      {
        notifyPeer,
        activeCall: this.activeCall
      }
    );


    // --------------------------------------------------------
    // Stop ringtone
    // --------------------------------------------------------

    this.stopRingtone();


    // --------------------------------------------------------
    // Stop duration timer
    // --------------------------------------------------------

    this.stopDurationTimer();


    // --------------------------------------------------------
    // Notify peer
    // --------------------------------------------------------

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

      } catch (e) {

        console.warn(
          '[Calls] Failed to notify peer about call end:',
          e
        );

      }
    }


    // --------------------------------------------------------
    // Cleanup WebRTC
    // --------------------------------------------------------

    webrtc.cleanup();


    // --------------------------------------------------------
    // Clear remote video
    // --------------------------------------------------------

    if (
      this.elements.remoteVideo
    ) {

      this.elements.remoteVideo.pause();

      this.elements.remoteVideo.srcObject =
        null;
    }


    // --------------------------------------------------------
    // Clear remote audio
    // --------------------------------------------------------

    if (
      this.elements.remoteAudio
    ) {

      this.elements.remoteAudio.pause();

      this.elements.remoteAudio.srcObject =
        null;
    }


    // --------------------------------------------------------
    // Clear local video
    // --------------------------------------------------------

    if (
      this.elements.localVideo
    ) {

      this.elements.localVideo.pause();

      this.elements.localVideo.srcObject =
        null;
    }


    // --------------------------------------------------------
    // Hide call modal
    // --------------------------------------------------------

    if (
      this.elements.callModal
    ) {

      this.elements.callModal
        .classList.remove(
          'active'
        );
    }


    // --------------------------------------------------------
    // Hide incoming overlay
    // --------------------------------------------------------

    if (
      this.elements.incomingOverlay
    ) {

      this.elements.incomingOverlay
        .classList.remove(
          'active'
        );
    }


    // --------------------------------------------------------
    // Reset state
    // --------------------------------------------------------

    this.activeCall =
      null;


    this.isAudioMuted =
      false;


    this.isVideoMuted =
      false;


    // --------------------------------------------------------
    // Reset microphone button
    // --------------------------------------------------------

    if (
      this.elements.btnMuteMic
    ) {

      this.elements.btnMuteMic
        .classList.remove(
          'muted'
        );


      this.elements.btnMuteMic.innerHTML =
        '🎤';
    }


    // --------------------------------------------------------
    // Reset camera button
    // --------------------------------------------------------

    if (
      this.elements.btnToggleCam
    ) {

      this.elements.btnToggleCam
        .classList.remove(
          'off'
        );


      this.elements.btnToggleCam.innerHTML =
        '📹';
    }


    console.log(
      '[Calls] Call cleanup complete.'
    );
  },


  // ==========================================================
  // SHOW CALL MODAL
  // ==========================================================

  showCallModal(
    callInfo
  ) {

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


    // --------------------------------------------------------
    // Peer information
    // --------------------------------------------------------

    if (
      this.elements.peerName
    ) {

      this.elements.peerName.textContent =
        callInfo.peerName ||
        'Contact';
    }


    if (
      this.elements.voiceAvatar
    ) {

      this.elements.voiceAvatar.src =
        avatar;
    }


    // ========================================================
    // VIDEO CALL
    // ========================================================

    if (isVideo) {

      if (
        this.elements.videoStage
      ) {

        this.elements.videoStage
          .classList.remove(
            'hidden'
          );
      }


      if (
        this.elements.voiceStage
      ) {

        this.elements.voiceStage
          .classList.add(
            'hidden'
          );
      }


      if (
        this.elements.btnToggleCam
      ) {

        this.elements.btnToggleCam
          .classList.remove(
            'hidden'
          );
      }


      if (
        this.elements.btnSwitchCam
      ) {

        this.elements.btnSwitchCam
          .classList.remove(
            'hidden'
          );
      }

    }

    // ========================================================
    // VOICE CALL
    // ========================================================

    else {

      if (
        this.elements.videoStage
      ) {

        this.elements.videoStage
          .classList.add(
            'hidden'
          );
      }


      if (
        this.elements.voiceStage
      ) {

        this.elements.voiceStage
          .classList.remove(
            'hidden'
          );
      }


      if (
        this.elements.btnToggleCam
      ) {

        this.elements.btnToggleCam
          .classList.add(
            'hidden'
          );
      }


      if (
        this.elements.btnSwitchCam
      ) {

        this.elements.btnSwitchCam
          .classList.add(
            'hidden'
          );
      }
    }


    // --------------------------------------------------------
    // Show modal
    // --------------------------------------------------------

    if (
      this.elements.callModal
    ) {

      this.elements.callModal
        .classList.add(
          'active'
        );
    }


    // --------------------------------------------------------
    // Prepare remote audio
    // --------------------------------------------------------

    if (
      this.elements.remoteAudio
    ) {

      this.elements.remoteAudio.autoplay =
        true;

      this.elements.remoteAudio.playsInline =
        true;

      this.elements.remoteAudio.volume =
        1.0;
    }


    // --------------------------------------------------------
    // Prepare remote video
    // --------------------------------------------------------

    if (
      this.elements.remoteVideo
    ) {

      this.elements.remoteVideo.autoplay =
        true;

      this.elements.remoteVideo.playsInline =
        true;
    }
  },


  // ==========================================================
  // UPDATE CALL STATUS
  // ==========================================================

  updateCallStatus(
    text
  ) {

    if (
      this.elements.callTimerEl
    ) {

      this.elements.callTimerEl.textContent =
        text;
    }
  },


  // ==========================================================
  // START CALL DURATION TIMER
  // ==========================================================

  startDurationTimer() {

    this.stopDurationTimer();


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


  // ==========================================================
  // STOP CALL DURATION TIMER
  // ==========================================================

  stopDurationTimer() {

    if (
      this.callTimer
    ) {

      clearInterval(
        this.callTimer
      );


      this.callTimer =
        null;
    }
  },


  // ==========================================================
  // RINGTONE
  // ==========================================================

  playRingtone(
    type = 'incoming'
  ) {

    this.stopRingtone();


    if (
      typeof Notifications === 'undefined'
    ) {

      console.warn(
        '[Calls] Notifications module unavailable.'
      );

      return;
    }


    Notifications.initAudio();


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


        const osc =
          ctx.createOscillator();


        const gain =
          ctx.createGain();


        osc.type =
          'sine';


        if (
          type === 'incoming'
        ) {

          // --------------------------------------------------
          // Incoming call tone
          // --------------------------------------------------

          osc.frequency.setValueAtTime(
            440,
            now
          );


          osc.frequency
            .exponentialRampToValueAtTime(
              880,
              now + 0.3
            );

        } else {

          // --------------------------------------------------
          // Outgoing ringback
          // --------------------------------------------------

          osc.frequency.setValueAtTime(
            440,
            now
          );
        }


        gain.gain.setValueAtTime(
          0.12,
          now
        );


        gain.gain
          .exponentialRampToValueAtTime(
            0.001,
            now + 0.6
          );


        osc.connect(
          gain
        );


        gain.connect(
          ctx.destination
        );


        osc.start(
          now
        );


        osc.stop(
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


  // ==========================================================
  // STOP RINGTONE
  // ==========================================================

  stopRingtone() {

    if (
      this.ringtoneInterval
    ) {

      clearInterval(
        this.ringtoneInterval
      );


      this.ringtoneInterval =
        null;
    }
  }
};
