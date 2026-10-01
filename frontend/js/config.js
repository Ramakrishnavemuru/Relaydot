// Application Configuration
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

// Use the current host in both local and production environments
const host = window.location.host;

const CONFIG = {
  API_BASE_URL: `${protocol}//${host}/api`,
  WS_URL: `${wsProtocol}//${host}/ws`,
  FILE_BASE_URL: `${protocol}//${host}`,
  TOKEN_KEY: 'chat_access_token',
  REFRESH_TOKEN_KEY: 'chat_refresh_token',
  USER_KEY: 'chat_user_data',
  SETTINGS_KEY: 'chat_app_settings',
  MAX_FILE_SIZE_MB: 15,
  ALLOWED_EXTENSIONS: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'doc', 'docx', 'txt', 'zip', 'mp3', 'mp4'],
  REACTION_EMOJIS: ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉'],
  EVENTS: {
    MESSAGE: 'message',
    MESSAGE_EDIT: 'message_edit',
    MESSAGE_DELETE: 'message_delete',
    TYPING_START: 'typing_start',
    TYPING_STOP: 'typing_stop',
    ONLINE: 'online',
    OFFLINE: 'offline',
    DELIVERED: 'delivered',
    READ: 'read',
    REACTION: 'reaction',
    CONVERSATION_NEW: 'conversation_new',
    CONVERSATION_UPDATE: 'conversation_update'
  }
};
