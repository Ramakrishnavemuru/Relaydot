// Notification Manager: Desktop Push & Audio Synthesis
const Notifications = {
  audioContext: null,

  // Get user notification preferences
  getSettings: () => {
    try {
      const saved = localStorage.getItem(CONFIG.SETTINGS_KEY);
      return saved ? JSON.parse(saved) : { soundEnabled: true, desktopEnabled: true };
    } catch {
      return { soundEnabled: true, desktopEnabled: true };
    }
  },

  saveSettings: (settings) => {
    localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(settings));
  },

  // Initialize Web Audio API for message chime
  initAudio: () => {
    if (!Notifications.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        Notifications.audioContext = new AudioCtx();
      }
    }
  },

  // Play a soft, pleasant notification chime synthesized with Web Audio API
  playChime: () => {
    const settings = Notifications.getSettings();
    if (!settings.soundEnabled) return;

    try {
      Notifications.initAudio();
      if (!Notifications.audioContext) return;

      if (Notifications.audioContext.state === 'suspended') {
        Notifications.audioContext.resume();
      }

      const ctx = Notifications.audioContext;
      const now = ctx.currentTime;

      // Note 1: E5 (659.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.15, now + 0.03);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2: A5 (880.00 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.0, now + 0.1);
      gain2.gain.setValueAtTime(0, now + 0.1);
      gain2.gain.linearRampToValueAtTime(0.2, now + 0.13);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.55);
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  },

  // Request browser desktop notification permissions
  requestPermission: async () => {
    if (!('Notification' in window)) {
      console.warn('Browser does not support desktop notifications.');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  },

  // Display desktop notification
  showDesktopNotification: (title, body, iconUrl, onClick) => {
    const settings = Notifications.getSettings();
    if (!settings.desktopEnabled) return;

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    // Only notify if document is hidden or window blurred
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      return;
    }

    try {
      const notification = new Notification(title, {
        body,
        icon: iconUrl || 'assets/icons/favicon.ico',
        badge: 'assets/icons/favicon.ico',
        tag: 'chat-message',
        renotify: true
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
        if (onClick) onClick();
      };
    } catch (e) {
      console.warn('Desktop notification error:', e);
    }
  },

  // Unified trigger for new incoming message
  notifyNewMessage: (message, conversationName, onClick) => {
    Notifications.playChime();

    const senderName = (message.sender && (message.sender.display_name || message.sender.username)) || 'Someone';
    const title = conversationName ? `${senderName} (${conversationName})` : senderName;
    const body = message.content || 'Sent an attachment';
    const icon = (message.sender && message.sender.avatar_url) || null;

    Notifications.showDesktopNotification(title, body, icon, onClick);
  }
};

// Initialize audio context on first user click to satisfy browser autoplay policies
window.addEventListener('click', () => Notifications.initAudio(), { once: true });
