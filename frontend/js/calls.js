// Real-Time Call Controller (Voice & Video)
const Calls = {
  activeCall: null,
  callTimer: null,
  callSeconds: 0,
  ringtoneInterval: null,
  isAudioMuted: false,
  isVideoMuted: false,

  // UI Elements cache
  elements: {},

  init() {
    this.elements = {
      // Incoming banner
      incomingOverlay: Utils.$('#incoming-call-overlay'),
      incomingAvatar: Utils.$('#incoming-caller-avatar'),
      incomingName: Utils.$('#incoming-caller-name'),
      incomingType: Utils.$('#incoming-call-type'),
      btnAccept: Utils.$('#btn-accept-call'),
      btnDecline: Utils.$('#btn-decline-call'),

      // Call Modal
      callModal: Utils.$('#call-modal-overlay'),
      peerName: Utils.$('#call-peer-name'),
      callTimerEl: Utils.$('#call-timer'),
      voiceStage: Utils.$('#voice-call-stage'),
      voiceAvatar: Utils.$('#voice-call-avatar'),
      videoStage: Utils.$('#video-call-stage'),
      remoteVideo: Utils.$('#remote-video-el'),
      localVideo: Utils.$('#local-video-el'),

      // Call Controls
      btnMuteMic: Utils.$('#btn-call-mute-mic'),
      btnToggleCam: Utils.$('#btn-call-toggle-cam'),
      btnSwitchCam: Utils.$('#btn-call-switch-cam'),
      btnEndCall: Utils.$('#btn-call-end')
    };

    webrtc.initConfig();
    this.bindSocketEvents();
    this.bindUI();
  },

  bindSocketEvents() {
    // 1. Incoming Call Invite
    WSClient.on('call_invite', (data) => {
      this.handleIncomingInvite(data);
    });

    // 2. Callee Accepted Call
    WSClient.on('call_accept', async (data) => {
      this.handleCallAccepted(data);
    });

    // 3. Callee Rejected Call
    WSClient.on('call_reject', (data) => {
      this.handleCallRejected(data);
    });

    // 4. WebRTC Offer received
    WSClient.on('webrtc_offer', async (data) => {
      this.handleWebRtcOffer(data);
    });

    // 5. WebRTC Answer received
    WSClient.on('webrtc_answer', async (data) => {
      this.handleWebRtcAnswer(data);
    });

    // 6. ICE candidate received
    WSClient.on('ice_candidate', async (data) => {
      if (data.candidate) {
        await webrtc.addIceCandidate(data.candidate);
      }
    });

    // 7. Call Terminated by peer
    WSClient.on('call_end', () => {
      Utils.showToast('Call ended by peer', 'info');
      this.endCall(false);
    });

    // WebRTC Callback when remote media stream is ready
    webrtc.onRemoteStreamCallback = (remoteStream) => {
      console.log('[Calls] Attaching remote stream to video element');
      if (this.elements.remoteVideo) {
        this.elements.remoteVideo.srcObject = remoteStream;
      }
    };

    // WebRTC Callback to send local ICE candidate to peer
    webrtc.onIceCandidateCallback = (candidate) => {
      if (this.activeCall) {
        WSClient.send('ice_candidate', {
          target_user_id: this.activeCall.peerId,
          candidate: candidate
        });
      }
    };
  },

  bindUI() {
    if (this.elements.btnAccept) {
      this.elements.btnAccept.addEventListener('click', () => this.acceptIncomingCall());
    }
    if (this.elements.btnDecline) {
      this.elements.btnDecline.addEventListener('click', () => this.declineIncomingCall());
    }

    if (this.elements.btnMuteMic) {
      this.elements.btnMuteMic.addEventListener('click', () => {
        this.isAudioMuted = !this.isAudioMuted;
        webrtc.toggleAudio(!this.isAudioMuted);
        this.elements.btnMuteMic.classList.toggle('muted', this.isAudioMuted);
        this.elements.btnMuteMic.innerHTML = this.isAudioMuted ? '🔇' : '🎤';
        Utils.showToast(this.isAudioMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
      });
    }

    if (this.elements.btnToggleCam) {
      this.elements.btnToggleCam.addEventListener('click', () => {
        this.isVideoMuted = !this.isVideoMuted;
        webrtc.toggleVideo(!this.isVideoMuted);
        this.elements.btnToggleCam.classList.toggle('off', this.isVideoMuted);
        this.elements.btnToggleCam.innerHTML = this.isVideoMuted ? '🚫' : '📹';
        Utils.showToast(this.isVideoMuted ? 'Camera disabled' : 'Camera enabled', 'info');
      });
    }

    if (this.elements.btnSwitchCam) {
      this.elements.btnSwitchCam.addEventListener('click', async () => {
        await webrtc.switchCamera();
        Utils.showToast('Camera switched', 'info');
      });
    }

    if (this.elements.btnEndCall) {
      this.elements.btnEndCall.addEventListener('click', () => {
        this.endCall(true);
      });
    }
  },

  // Start outgoing call
  async startCall(peerUser, callType = 'video') {
    if (!peerUser) return;
    if (this.activeCall) {
      Utils.showToast('You are already in a call', 'warning');
      return;
    }

    this.activeCall = {
      peerId: peerUser.id,
      peerName: peerUser.display_name || peerUser.username,
      peerAvatar: peerUser.avatar_url,
      callType: callType,
      role: 'caller',
      state: 'calling'
    };

    try {
      // 1. Acquire local media
      const localStream = await webrtc.getMediaStream(callType);
      if (this.elements.localVideo && callType === 'video') {
        this.elements.localVideo.srcObject = localStream;
      }

      // 2. Open call modal in "Calling..." state
      this.showCallModal(this.activeCall);
      this.updateCallStatus('Calling...');
      this.playRingtone('outgoing');

      // 3. Send call invite over WebSocket
      WSClient.send('call_invite', {
        target_user_id: peerUser.id,
        call_type: callType
      });
    } catch (err) {
      Utils.showToast(err.message, 'error');
      this.endCall(false);
    }
  },

  // Handle incoming invite
  handleIncomingInvite(data) {
    if (this.activeCall) {
      // Busy with another call
      WSClient.send('call_reject', {
        target_user_id: data.caller_id,
        reason: 'busy'
      });
      return;
    }

    this.activeCall = {
      peerId: data.caller_id,
      peerName: data.caller_name || 'Contact',
      peerAvatar: data.caller_avatar,
      callType: data.call_type || 'audio',
      role: 'callee',
      state: 'incoming'
    };

    // Render incoming banner
    const avatar = API.resolveUrl(data.caller_avatar) || `https://api.dicebear.com/7.x/initials/svg?seed=${data.caller_name}`;
    this.elements.incomingAvatar.src = avatar;
    this.elements.incomingName.textContent = data.caller_name;
    this.elements.incomingType.textContent = `Incoming ${data.call_type === 'video' ? 'Video' : 'Voice'} Call...`;

    this.elements.incomingOverlay.classList.add('active');
    this.playRingtone('incoming');
  },

  // Callee accepts
  async acceptIncomingCall() {
    this.stopRingtone();
    this.elements.incomingOverlay.classList.remove('active');

    if (!this.activeCall) return;

    try {
      // 1. Acquire local stream
      const localStream = await webrtc.getMediaStream(this.activeCall.callType);
      if (this.elements.localVideo && this.activeCall.callType === 'video') {
        this.elements.localVideo.srcObject = localStream;
      }

      // 2. Show call modal
      this.showCallModal(this.activeCall);
      this.updateCallStatus('Connecting...');

      // 3. Notify caller that we accepted
      WSClient.send('call_accept', {
        target_user_id: this.activeCall.peerId,
        call_type: this.activeCall.callType
      });
    } catch (err) {
      Utils.showToast(err.message, 'error');
      this.declineIncomingCall();
    }
  },

  // Callee declines
  declineIncomingCall() {
    this.stopRingtone();
    this.elements.incomingOverlay.classList.remove('active');

    if (this.activeCall) {
      WSClient.send('call_reject', {
        target_user_id: this.activeCall.peerId,
        reason: 'declined'
      });
    }
    this.endCall(false);
  },

  // Caller receives call_accept: Create Offer
  async handleCallAccepted(data) {
    this.stopRingtone();
    this.updateCallStatus('Connecting...');

    try {
      const offer = await webrtc.createOffer();
      WSClient.send('webrtc_offer', {
        target_user_id: this.activeCall.peerId,
        offer: offer
      });
    } catch (err) {
      console.error('[Calls] Failed to create offer:', err);
      this.endCall(true);
    }
  },

  // Caller receives call_reject
  handleCallRejected(data) {
    this.stopRingtone();
    const reasonMsg = data.reason === 'busy' ? 'User is busy on another call.' : (data.message || 'Call was declined.');
    Utils.showToast(reasonMsg, 'info');
    this.endCall(false);
  },

  // Callee receives WebRTC Offer: Create Answer
  async handleWebRtcOffer(data) {
    try {
      const answer = await webrtc.handleOfferAndCreateAnswer(data.offer);
      WSClient.send('webrtc_answer', {
        target_user_id: this.activeCall.peerId,
        answer: answer
      });
      this.startDurationTimer();
    } catch (err) {
      console.error('[Calls] Error handling offer:', err);
      this.endCall(true);
    }
  },

  // Caller receives WebRTC Answer
  async handleWebRtcAnswer(data) {
    try {
      await webrtc.handleAnswer(data.answer);
      this.startDurationTimer();
    } catch (err) {
      console.error('[Calls] Error handling answer:', err);
    }
  },

  // End Call
  endCall(notifyPeer = true) {
    this.stopRingtone();
    this.stopDurationTimer();

    if (this.activeCall && notifyPeer) {
      WSClient.send('call_end', {
        target_user_id: this.activeCall.peerId
      });
    }

    webrtc.cleanup();

    if (this.elements.remoteVideo) this.elements.remoteVideo.srcObject = null;
    if (this.elements.localVideo) this.elements.localVideo.srcObject = null;
    if (this.elements.callModal) this.elements.callModal.classList.remove('active');
    if (this.elements.incomingOverlay) this.elements.incomingOverlay.classList.remove('active');

    this.activeCall = null;
    this.isAudioMuted = false;
    this.isVideoMuted = false;
    if (this.elements.btnMuteMic) {
      this.elements.btnMuteMic.classList.remove('muted');
      this.elements.btnMuteMic.innerHTML = '🎤';
    }
    if (this.elements.btnToggleCam) {
      this.elements.btnToggleCam.classList.remove('off');
      this.elements.btnToggleCam.innerHTML = '📹';
    }
  },

  showCallModal(callInfo) {
    const isVideo = callInfo.callType === 'video';
    const avatar = API.resolveUrl(callInfo.peerAvatar) || `https://api.dicebear.com/7.x/initials/svg?seed=${callInfo.peerName}`;

    this.elements.peerName.textContent = callInfo.peerName;
    this.elements.voiceAvatar.src = avatar;

    if (isVideo) {
      this.elements.videoStage.classList.remove('hidden');
      this.elements.voiceStage.classList.add('hidden');
      this.elements.btnToggleCam.classList.remove('hidden');
      this.elements.btnSwitchCam.classList.remove('hidden');
    } else {
      this.elements.videoStage.classList.add('hidden');
      this.elements.voiceStage.classList.remove('hidden');
      this.elements.btnToggleCam.classList.add('hidden');
      this.elements.btnSwitchCam.classList.add('hidden');
    }

    this.elements.callModal.classList.add('active');
  },

  updateCallStatus(text) {
    if (this.elements.callTimerEl) {
      this.elements.callTimerEl.textContent = text;
    }
  },

  startDurationTimer() {
    this.stopDurationTimer();
    this.callSeconds = 0;
    this.updateCallStatus('00:00');

    this.callTimer = setInterval(() => {
      this.callSeconds++;
      const mins = String(Math.floor(this.callSeconds / 60)).padStart(2, '0');
      const secs = String(this.callSeconds % 60).padStart(2, '0');
      this.updateCallStatus(`${mins}:${secs}`);
    }, 1000);
  },

  stopDurationTimer() {
    if (this.callTimer) {
      clearInterval(this.callTimer);
      this.callTimer = null;
    }
  },

  // Ringtone synthesizer via Web Audio API
  playRingtone(type = 'incoming') {
    this.stopRingtone();
    Notifications.initAudio();

    const playTone = () => {
      if (!Notifications.audioContext) return;
      const ctx = Notifications.audioContext;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';

      if (type === 'incoming') {
        // High dual chirp
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
      } else {
        // Standard US ringback tone
        osc.frequency.setValueAtTime(440, now);
      }

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    };

    playTone();
    this.ringtoneInterval = setInterval(playTone, type === 'incoming' ? 2000 : 3500);
  },

  stopRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }
};
