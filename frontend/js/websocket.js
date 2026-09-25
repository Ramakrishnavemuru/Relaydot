// Real-Time WebSocket Client
class WebSocketManager {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 15;
    this.reconnectDelay = 2000;
    this.heartbeatInterval = null;
    this.isConnected = false;
  }

  connect() {
    const token = API.getToken();
    if (!token) {
      console.warn('Cannot connect WebSocket: No auth token');
      return;
    }

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = `${CONFIG.WS_URL}?token=${encodeURIComponent(token)}`;
    console.log(`[WS] Connecting to ${CONFIG.WS_URL}...`);

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('[WS] Connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.trigger('connection_open', { status: 'connected' });
      };

      this.socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const eventType = payload.event;
          const data = payload.data || {};

          if (eventType === 'pong') {
            return;
          }

          console.log(`[WS] Received event [${eventType}]`, data);
          this.trigger(eventType, data);
        } catch (err) {
          console.error('[WS] Failed to parse message:', event.data, err);
        }
      };

      this.socket.onclose = (event) => {
        console.log(`[WS] Disconnected (code: ${event.code})`);
        this.isConnected = false;
        this.stopHeartbeat();
        this.trigger('connection_close', { code: event.code });

        // Do not reconnect if unauthorized
        if (event.code !== 1008 && Auth.isAuthenticated()) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = (err) => {
        console.error('[WS] Error:', err);
        this.trigger('connection_error', err);
      };
    } catch (e) {
      console.error('[WS] Connection exception:', e);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
    console.log(`[WS] Scheduling reconnect #${this.reconnectAttempts} in ${Math.round(delay / 1000)}s`);

    setTimeout(() => {
      if (Auth.isAuthenticated()) {
        this.connect();
      }
    }, delay);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send('ping', {});
      }
    }, 25000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  send(event, data = {}) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ event, data }));
      return true;
    }
    console.warn(`[WS] Cannot send event ${event}: socket not open`);
    return false;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  trigger(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`[WS] Error in event listener for ${event}:`, e);
        }
      });
    }
  }

  // Quick Action Helpers
  sendTypingStart(conversationId) {
    this.send(CONFIG.EVENTS.TYPING_START, { conversation_id: conversationId });
  }

  sendTypingStop(conversationId) {
    this.send(CONFIG.EVENTS.TYPING_STOP, { conversation_id: conversationId });
  }

  sendRead(conversationId) {
    this.send(CONFIG.EVENTS.READ, { conversation_id: conversationId });
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.close(1000, 'User logged out');
      this.socket = null;
    }
    this.isConnected = false;
  }
}

// Global WebSocket Client instance
const WSClient = new WebSocketManager();
