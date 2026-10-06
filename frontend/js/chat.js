// Real-Time Chat Application Engine
document.addEventListener('DOMContentLoaded', async () => {
  // Enforce authentication
  if (!Auth.requireAuth()) return;

  let currentUser;
  try { currentUser = await Auth.fetchMyProfile(); }
  catch {
    currentUser = Auth.getCurrentUser();
    if (!currentUser || !Auth.isAuthenticated()) return;
    Utils.showToast('Your profile couldn’t refresh. Showing your saved account while reconnecting.', 'warning');
  }
  let conversations = [];
  let activeConversation = null;
  let messages = [];
  let replyingToMessage = null;
  let editingMessage = null;
  let forwardingMessage = null;
  let reportingMessageId = null;
  let threadRoot = null;
  const threadMessageIds = new Set();
  let pendingAttachments = [];
  let typingTimer = null;
  let isTyping = false;
  let activeFilter = 'all';
  let messageRequest = 0;
  let conversationRequest = 0;
  let hasEarlier = false;
  let loadingEarlier = false;
  let uploading = 0;
  let selectedSharedTab = 'media';
  const outboxKey = `relay-outbox-${currentUser.id}`;
  const outbox = new Map(AppUI.read(outboxKey,[]).filter(m => m.sender_id === currentUser.id && String(m.id).startsWith('local-') && m.payload).map(m => [m.id,{...m,status:'FAILED',requesting:false}]));
  const saveOutbox = () => AppUI.write(outboxKey,[...outbox.values()].map(({requesting,...entry}) => entry));
  const preferenceKey = `relay-chats-${currentUser.id}`;
  const draftKey = `relay-drafts-${currentUser.id}`;
  const preferences = AppUI.read(preferenceKey, {});
  const drafts = AppUI.read(draftKey, {});
  const chatName = conv => conv.name || conv.other_user?.display_name || conv.other_user?.username || 'Conversation';
  const chatAvatar = conv => AppUI.avatarUrl(conv.avatar_url || conv.other_user?.avatar_url,chatName(conv));
  const pref = id => preferences[id] || {};
  const viewingSearchHistory = () => !document.getElementById('history-context').classList.contains('hidden');
  const visibleChat = id => activeConversation?.id === id && !viewingSearchHistory() && document.visibilityState === 'visible' && (innerWidth > 768 || document.body.classList.contains('mobile-chat-open'));
  const saveDraft = () => {
    if (!activeConversation || editingMessage) return;
    const text = elements.messageInput.value;
    if (text || pendingAttachments.length) drafts[activeConversation.id] = {text, attachments: pendingAttachments};
    else delete drafts[activeConversation.id];
    AppUI.write(draftKey, drafts);
  };
  const syncComposer = () => {
    elements.btnSendMessage.disabled = uploading > 0 || (!elements.messageInput.value.trim() && !pendingAttachments.length);
    elements.btnSendMessage.setAttribute('aria-label', editingMessage ? 'Save edited message' : 'Send message');
    elements.messageInput.style.height = 'auto';
    elements.messageInput.style.height = Math.min(elements.messageInput.scrollHeight, 140) + 'px';
  };
  const markRead = async conv => {
    if (!visibleChat(conv.id)) return;
    if (!WSClient.send(CONFIG.EVENTS.READ, {conversation_id: conv.id})) {
      try { await API.post('/messages/read', {conversation_id: conv.id}); } catch { return; }
    }
    conv.unread_count = 0;
    renderConversationsList();
  };
  const updatePreference = (id, key) => {
    preferences[id] = {...pref(id), [key]: !pref(id)[key]};
    if (!AppUI.write(preferenceKey, preferences)) Utils.showToast('Your browser could not save this preference.', 'warning');
    renderConversationsList();
  };
  const openChatMenu = (trigger, conv) => AppUI.showMenu(trigger, [
    {label: pref(conv.id).pinned ? 'Unpin conversation' : 'Pin conversation', icon: 'pin', run: () => updatePreference(conv.id,'pinned')},
    {label: pref(conv.id).favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', run: () => updatePreference(conv.id,'favorite')},
    {label: pref(conv.id).muted ? 'Unmute notifications' : 'Mute notifications', icon: 'bell-off', run: () => updatePreference(conv.id,'muted')},
    {label: pref(conv.id).archived ? 'Move to all chats' : 'Archive conversation', icon: 'archive', run: () => updatePreference(conv.id,'archived')},
    {label:'Saved messages',icon:'bookmark',run:openSavedMessages},
    {label:'Scheduled messages',icon:'clock',run:openScheduledMessages}
  ]);

  // DOM Elements
  const elements = {
    // Current user bar
    myAvatar: Utils.$('#my-avatar'),
    myName: Utils.$('#my-name'),
    myStatusDot: Utils.$('#my-status-dot'),
    btnNewChat: Utils.$('#btn-new-chat'),
    btnNewGroup: Utils.$('#btn-new-group'),
    btnSettings: Utils.$('#btn-settings'),
    btnLogout: Utils.$('#btn-logout'),

    // Search bar
    convSearchInput: Utils.$('#conv-search-input'),
    conversationsList: Utils.$('#conversations-list'),

    // Chat Window
    emptyChatState: Utils.$('#empty-chat-state'),
    activeChatWindow: Utils.$('#active-chat-window'),
    chatAvatar: Utils.$('#chat-avatar'),
    chatTitle: Utils.$('#chat-title'),
    chatSubtitle: Utils.$('#chat-subtitle'),
    chatHeaderStatus: Utils.$('#chat-header-status'),
    btnSearchMessages: Utils.$('#btn-search-messages'),
    btnVoiceCall: Utils.$('#btn-voice-call'),
    btnVideoCall: Utils.$('#btn-video-call'),
    btnAddStory: Utils.$('#btn-add-story'),
    btnChatInfo: Utils.$('#btn-chat-info'),
    btnMobileBack: Utils.$('#btn-mobile-back'),

    // Message History
    messagesContainer: Utils.$('#messages-container'),
    messagesList: Utils.$('#messages-list'),
    typingIndicator: Utils.$('#typing-indicator'),
    typingText: Utils.$('#typing-text'),

    // Input Bar
    replyPreviewBar: Utils.$('#reply-preview-bar'),
    replyAuthor: Utils.$('#reply-author'),
    replyContent: Utils.$('#reply-content'),
    btnCancelReply: Utils.$('#btn-cancel-reply'),

    editPreviewBar: Utils.$('#edit-preview-bar'),
    editContent: Utils.$('#edit-content'),
    btnCancelEdit: Utils.$('#btn-cancel-edit'),

    attachmentPreviewBar: Utils.$('#attachment-preview-bar'),
    attachmentPreviews: Utils.$('#attachment-previews'),

    messageInput: Utils.$('#message-input'),
    btnAttachment: Utils.$('#btn-attachment'),
    fileInput: Utils.$('#file-input'),
    btnEmoji: Utils.$('#btn-emoji'),
    emojiPickerPopup: Utils.$('#emoji-picker-popup'),
    btnSendMessage: Utils.$('#btn-send-message'),

    // Modals
    modalNewChat: Utils.$('#modal-new-chat'),
    modalNewGroup: Utils.$('#modal-new-group'),
    modalGroupInfo: Utils.$('#modal-group-info'),
    modalSearchMessages: Utils.$('#modal-search-messages'),
    modalSettings: Utils.$('#modal-settings'),
    modalUserProfile: Utils.$('#modal-user-profile')
  };

  // Setup current user profile in header
  const initUserHeader = () => {
    if (elements.myAvatar) {
      elements.myAvatar.src = AppUI.avatarUrl(currentUser.avatar_url,currentUser.display_name || currentUser.username);
    }
    if (elements.myName) {
      elements.myName.textContent = currentUser.display_name || currentUser.username;
    }
  };

  // Existing socket events remain the source of live updates.
  const initWebSocket = () => {
    let connectedOnce = false;
    const connection = connected => {
      elements.myStatusDot.className = `online-dot ${connected ? 'online' : 'offline'}`;
      document.querySelector('.connection-dot').classList.toggle('disconnected', !connected);
      document.getElementById('connection-label').textContent = connected ? 'Connected' : navigator.onLine ? 'Reconnecting…' : 'You’re offline';
      document.getElementById('connection-banner').classList.toggle('hidden', connected);
      document.getElementById('connection-message').textContent = navigator.onLine ? 'Connection interrupted. Reconnecting…' : 'You’re offline. Your draft stays here until you’re back.';
    };
    WSClient.on('connection_open', async () => {
      connection(true);
      if (connectedOnce) {
        Utils.showToast('Connection restored', 'success');
        await loadConversations();
        if (activeConversation && !viewingSearchHistory()) await loadMessageHistory(activeConversation, true);
      }
      connectedOnce = true;
    });
    WSClient.on('connection_close', () => connection(false));
    WSClient.on('connection_error', () => connection(false));
    window.addEventListener('offline', () => connection(false));
    window.addEventListener('online', () => { WSClient.connect(); });
    document.getElementById('btn-reconnect').onclick = () => { WSClient.reconnectAttempts = 0; WSClient.connect(); };
    WSClient.connect();

    // Incoming new message
    WSClient.on(CONFIG.EVENTS.MESSAGE, (msg) => {
      handleIncomingMessage(msg);
    });

    // Message edited
    WSClient.on(CONFIG.EVENTS.MESSAGE_EDIT, (msg) => {
      handleMessageEdited(msg);
    });

    // Message deleted
    WSClient.on(CONFIG.EVENTS.MESSAGE_DELETE, (data) => {
      handleMessageDeleted(data);
    });
    WSClient.on('message.pinned', data => {
      const msg = messages.find(m => m.id === data.message_id);
      if (msg) { msg.pinned_at = data.pinned ? new Date().toISOString() : null;
        document.getElementById(`msg-${msg.id}`)?.replaceWith(createMessageElement(msg)); }
    });
    WSClient.on('message.scheduled.sent', () => { if (activeConversation) loadMessageHistory(activeConversation,true); });
    WSClient.on('message.scheduled.failed', data => Utils.showToast(data.error || 'Scheduled message failed.', 'error'));

    // Reaction updated
    WSClient.on(CONFIG.EVENTS.REACTION, (data) => {
      handleReactionUpdate(data);
    });

    // Typing start
    WSClient.on(CONFIG.EVENTS.TYPING_START, (data) => {
      if (activeConversation && activeConversation.id === data.conversation_id && data.user_id !== currentUser.id) {
        showTypingIndicator(data.display_name || data.username);
      }
    });

    // Typing stop
    WSClient.on(CONFIG.EVENTS.TYPING_STOP, (data) => {
      if (activeConversation && activeConversation.id === data.conversation_id && data.user_id !== currentUser.id) {
        hideTypingIndicator();
      }
    });

    // Read receipt
    WSClient.on(CONFIG.EVENTS.READ, (data) => {
      handleReadReceipt(data);
    });

    // User online status update
    WSClient.on(CONFIG.EVENTS.ONLINE, (data) => {
      updateUserPresence(data.user_id, true);
    });

    // User offline status update
    WSClient.on(CONFIG.EVENTS.OFFLINE, (data) => {
      updateUserPresence(data.user_id, false, data.last_seen);
    });
    WSClient.on(CONFIG.EVENTS.DELIVERED, data => {
      messages.filter(m => m.id === data.message_id || data.message_ids?.includes(m.id)).forEach(m => {
        if (m.status !== 'READ') { m.status = 'DELIVERED'; document.getElementById(`msg-${m.id}`)?.replaceWith(createMessageElement(m)); }
      });
    });
    [CONFIG.EVENTS.CONVERSATION_NEW, CONFIG.EVENTS.CONVERSATION_UPDATE, 'member_joined', 'member_left'].forEach(event => WSClient.on(event, () => loadConversations()));
    WSClient.on('social_notification', data => {
      const badge = document.getElementById('chat-social-unread');
      badge.textContent = Number(badge.textContent || 0) + 1;
      badge.classList.remove('hidden');
      if (data.type !== 'message') Utils.showToast('New activity on Relay', 'info');
    });
    API.get('/social/notifications', {limit:1}).then(data => {
      const badge = document.getElementById('chat-social-unread');
      badge.textContent = data.unread;
      badge.classList.toggle('hidden', !data.unread);
    }).catch(() => {});
    WSClient.on('error', () => Utils.showToast('That action could not be completed. Please try again.', 'error'));
  };

  const loadConversations = async () => {
    const request = ++conversationRequest;
    try {
      const result = await API.get('/conversations');
      if (request !== conversationRequest) return;
      conversations = result;
      if (activeConversation) {
        const refreshed = conversations.find(c => c.id === activeConversation.id);
        if (refreshed) {
          activeConversation = refreshed;
          updateChatHeader();
          if (elements.modalGroupInfo.classList.contains('active')) setupChatInfoModal();
        } else closeConversation();
      }
      renderConversationsList();
      const requestedConversation = Number(new URLSearchParams(location.search).get('conversation'));
      if (requestedConversation && !activeConversation) {
        const requested = conversations.find(c => c.id === requestedConversation);
        if (requested) {
          await selectConversation(requested);
          const requestedMessage = Number(new URLSearchParams(location.search).get('message'));
          if (requestedMessage) {
            try { const msg = await API.get(`/messages/${requestedMessage}`);
              if (msg.conversation_id !== requestedConversation) return;
              if (msg.thread_root_id) await openThread(msg);
              else {
                if (!messages.some(item => item.id === msg.id)) { messages = await API.get(
                  `/messages/conversation/${requestedConversation}`,{before_id:msg.id+1,limit:50}); renderMessages();
                  document.getElementById('history-context').classList.remove('hidden'); }
                document.getElementById(`msg-${msg.id}`)?.scrollIntoView({block:'center'});
              }
            } catch { Utils.showToast('This message is unavailable.','info'); }
          }
        }
      }
    } catch {
      if (request !== conversationRequest) return;
      elements.conversationsList.innerHTML = '<div class="list-empty"><span data-icon="wifi-off"></span><h3>Conversations couldn’t load</h3><p>Check your connection and try again.</p><button class="btn btn-secondary" id="btn-retry-conversations">Try again</button></div>';
      document.getElementById('btn-retry-conversations').onclick = loadConversations;
    }
  };

  const renderConversationsList = () => {
    if (!elements.conversationsList) return;
    const q = elements.convSearchInput.value.trim();
    const filtered = conversations.filter(c => {
      const p = pref(c.id);
      const matches = `${chatName(c)} ${c.other_user?.username || ''}`.toLowerCase().includes(q.toLowerCase());
      return matches && (activeFilter === 'archived' ? p.archived : !p.archived) &&
        (activeFilter !== 'unread' || c.unread_count > 0) &&
        (activeFilter !== 'groups' || c.type === 'GROUP') &&
        (activeFilter !== 'favorites' || p.favorite);
    }).sort((a,b) => Number(!!pref(b.id).pinned) - Number(!!pref(a.id).pinned));
    document.getElementById('conversation-count').textContent = conversations.filter(c => !pref(c.id).archived).length;
    const totalUnread = conversations.reduce((count,c) => count + (c.unread_count || 0), 0);
    document.getElementById('unread-count').textContent = totalUnread || '';
    document.title = `${totalUnread ? `(${totalUnread}) ` : ''}Relay — Messages`;
    document.getElementById('btn-clear-conversation-search').classList.toggle('hidden', !q);
    document.querySelector('.search-input-wrap kbd').classList.toggle('hidden', !!q);
    const existing = new Map([...elements.conversationsList.querySelectorAll('.conversation-item')].map(item => [Number(item.dataset.id),item]));
    if (!filtered.length) {
      const copy = q ? ['No matching conversations', 'Try another name, or search all messages.'] : activeFilter === 'unread' ? ['You’re all caught up', 'New messages will appear here.'] : activeFilter === 'groups' ? ['Better conversations, together', 'Create a group for your favorite people.'] : activeFilter === 'favorites' ? ['Keep your people close', 'Add a conversation to favorites from its menu.'] : activeFilter === 'archived' ? ['A little breathing room', 'Archived conversations will appear here.'] : ['No conversations yet', 'Say hello. Good things start there.'];
      elements.conversationsList.innerHTML = `<div class="list-empty"><span data-icon="${activeFilter === 'unread' ? 'check-check' : 'message'}"></span><h3>${copy[0]}</h3><p>${copy[1]}</p>${['all','groups'].includes(activeFilter) && !q ? '<button class="btn btn-secondary" id="btn-list-new-chat">Start a conversation</button>' : ''}${q ? '<button class="btn btn-secondary" id="btn-list-search-all">Search all messages</button>' : ''}</div>`;
      document.getElementById('btn-list-new-chat')?.addEventListener('click', activeFilter === 'groups' ? setupNewGroupModal : setupNewChatModal);
      document.getElementById('btn-list-search-all')?.addEventListener('click', () => setupSearchMessagesModal(null, q));
      return;
    }
    elements.conversationsList.querySelector('.list-empty, [aria-label="Loading conversations"]')?.remove();
    existing.forEach((item,id) => { if (!filtered.some(conv => conv.id === id)) item.remove(); });
    filtered.forEach((conv,index) => {
      const p = pref(conv.id); const name = chatName(conv); const isGroup = conv.type === 'GROUP';
      const item = existing.get(conv.id) || document.createElement('div');
      item.className = `conversation-item ${activeConversation?.id === conv.id ? 'active' : ''} ${conv.unread_count ? 'has-unread' : ''}`;
      item.dataset.id = conv.id;
      const last = conv.last_message;
      const snippet = last ? last.is_deleted ? 'Message deleted' : last.content || 'Sent an attachment' : 'Say hello to start the conversation';
      const time = last ? Utils.formatDateHeader(last.created_at) === 'Today' ? Utils.formatMessageTime(last.created_at) : Utils.formatDateHeader(last.created_at) : '';
      const html = `<button class="conversation-select" aria-label="${Utils.escapeHTML(name)}${conv.unread_count ? `, ${conv.unread_count} unread messages` : ''}" ${activeConversation?.id === conv.id ? 'aria-current="true"' : ''}>
        <span class="conv-avatar-wrap"><img src="${Utils.escapeHTML(chatAvatar(conv))}" alt="" class="conv-avatar" loading="lazy" />${!isGroup && conv.other_user?.is_online ? '<span class="online-dot online" aria-label="Online"></span>' : isGroup ? '<span class="group-badge" data-icon="users"></span>' : ''}</span>
        <span class="conv-details"><span class="conv-header"><span class="conv-name">${AppUI.highlight(name,q)}</span><span class="conv-time">${time}</span></span>
        <span class="conv-footer"><span class="conv-snippet">${drafts[conv.id]?.text ? `<span class="draft-label">Draft:</span> ${Utils.escapeHTML(drafts[conv.id].text)}` : `${last?.sender_id === currentUser.id ? 'You: ' : ''}${Utils.escapeHTML(snippet)}`}</span><span class="conv-indicators">${p.pinned ? AppUI.icon('pin') : ''}${p.muted ? AppUI.icon('bell-off') : ''}${p.favorite ? AppUI.icon('star') : ''}${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count > 99 ? '99+' : conv.unread_count}</span>` : ''}</span></span></span>
        </button><button class="conversation-menu icon-btn" title="Conversation options" aria-label="Options for ${Utils.escapeHTML(name)}" aria-haspopup="menu" aria-expanded="false">${AppUI.icon('more')}</button>`;
      if (item.renderedHTML !== html) { item.innerHTML = html; item.renderedHTML = html; }
      item.querySelector('.conversation-select').onclick = () => selectConversation(conv);
      item.querySelector('.conversation-menu').onclick = e => openChatMenu(e.currentTarget, conv);
      if (elements.conversationsList.children[index] !== item) elements.conversationsList.insertBefore(item,elements.conversationsList.children[index] || null);
    });
  };

  const updateChatHeader = () => {
    if (!activeConversation) return;
    const conv = activeConversation; const isGroup = conv.type === 'GROUP';
    elements.chatAvatar.src = chatAvatar(conv); elements.chatAvatar.alt = chatName(conv);
    elements.chatTitle.textContent = chatName(conv);
    elements.chatSubtitle.textContent = isGroup ? `${conv.members.length} members` : Utils.formatLastSeen(conv.other_user?.is_online, conv.other_user?.last_seen);
    elements.chatHeaderStatus.className = `status-text ${!isGroup && conv.other_user?.is_online ? 'online-text' : ''}`;
    elements.btnVoiceCall.classList.toggle('hidden',isGroup); elements.btnVideoCall.classList.toggle('hidden',isGroup);
  };
  const closeConversation = () => {
    saveDraft(); stopTyping(); activeConversation = null; messages = []; messageRequest++;
    document.body.classList.remove('mobile-chat-open');
    elements.activeChatWindow.classList.add('hidden'); elements.emptyChatState.classList.remove('hidden');
    Utils.closeModal('modal-group-info'); renderConversationsList();
  };
  const loadMessageHistory = async (conv, preserve = false) => {
    const request = ++messageRequest;
    if (!preserve) {
      messages = []; elements.messagesList.innerHTML = '<div class="message-skeleton" aria-label="Loading messages"><span></span><span></span><span></span></div>';
    }
    elements.messagesList.setAttribute('aria-busy','true');
    try {
      const history = await API.get(`/messages/conversation/${conv.id}`, {limit: 50});
      if (request !== messageRequest || activeConversation?.id !== conv.id) return;
      const seen = new Map();
      if (preserve) messages.forEach(m => seen.set(m.id,m));
      history.forEach(m => seen.set(m.id,m));
      messages.forEach(m => { if (!seen.has(m.id)) seen.set(m.id,m); });
      outbox.forEach(m => { if (m.conversation_id === conv.id) seen.set(m.id,m); });
      messages = [...seen.values()].sort((a,b) => Utils.parseDate(a.created_at) - Utils.parseDate(b.created_at));
      hasEarlier = preserve ? hasEarlier || history.length === 50 : history.length === 50;
      document.getElementById('btn-load-earlier').classList.toggle('hidden', !hasEarlier);
      renderMessages(); scrollToBottom(); await markRead(conv);
      if (elements.modalGroupInfo.classList.contains('active')) renderSharedContent();
    } catch {
      if (request !== messageRequest || activeConversation?.id !== conv.id) return;
      if (!preserve) {
        elements.messagesList.innerHTML = '<div class="list-empty"><span data-icon="alert-circle"></span><h3>Messages couldn’t load</h3><p>Check your connection and try again.</p><button id="btn-retry-history" class="btn btn-secondary">Try again</button></div>';
        document.getElementById('btn-retry-history').onclick = () => loadMessageHistory(conv);
      } else Utils.showToast('Recent messages couldn’t sync. Try again when connected.', 'error');
    } finally { if (request === messageRequest) elements.messagesList.setAttribute('aria-busy','false'); }
  };
  const loadEarlierMessages = async () => {
    if (!activeConversation || !hasEarlier || loadingEarlier) return;
    const convId = activeConversation.id; const button = document.getElementById('btn-load-earlier');
    const first = messages.find(m => typeof m.id === 'number'); if (!first) return;
    loadingEarlier = true; button.disabled = true; button.textContent = 'Loading…';
    try {
      const earlier = await API.get(`/messages/conversation/${convId}`, {limit:50, before_id:first.id});
      if (activeConversation?.id !== convId) return;
      const height = elements.messagesContainer.scrollHeight, top = elements.messagesContainer.scrollTop;
      const ids = new Set(messages.map(m => m.id)); messages = [...earlier.filter(m => !ids.has(m.id)), ...messages];
      hasEarlier = earlier.length === 50; renderMessages(); button.classList.toggle('hidden', !hasEarlier);
      elements.messagesContainer.scrollTop = top + elements.messagesContainer.scrollHeight - height;
    } catch { Utils.showToast('Earlier messages couldn’t load. Please try again.', 'error'); }
    finally { loadingEarlier = false; button.disabled = false; button.textContent = 'Load earlier messages'; }
  };
  const selectConversation = async conv => {
    document.getElementById('history-context').classList.add('hidden');
    AppUI.closeMenu(); saveDraft(); stopTyping(); hideTypingIndicator();
    activeConversation = conv; replyingToMessage = null; editingMessage = null;
    hideReplyPreview(); hideEditPreview();
    pendingAttachments = drafts[conv.id]?.attachments || [];
    elements.messageInput.value = drafts[conv.id]?.text || ''; renderAttachmentPreviews(); syncComposer();
    document.body.classList.add('mobile-chat-open');
    elements.emptyChatState.classList.add('hidden'); elements.activeChatWindow.classList.remove('hidden');
    updateChatHeader(); renderConversationsList();
    if (elements.modalGroupInfo.classList.contains('active')) setupChatInfoModal();
    await loadMessageHistory(conv);
  };

  // Append live messages without replacing existing focused bubbles or loaded images.
  const appendMessage = msg => {
    elements.messagesList.querySelector('.conversation-start, .message-skeleton, .list-empty')?.remove();
    const date = Utils.formatDateHeader(msg.created_at);
    const separators = elements.messagesList.querySelectorAll('.message-date-separator');
    if (separators[separators.length - 1]?.textContent !== date) {
      const separator = document.createElement('div'); separator.className = 'message-date-separator';
      const label = document.createElement('span'); label.textContent = date; separator.append(label);
      elements.messagesList.append(separator);
    }
    elements.messagesList.append(createMessageElement(msg));
  };
  const renderMessages = () => {
    elements.messagesList.replaceChildren();
    if (!messages.length) {
      elements.messagesList.innerHTML = '<div class="conversation-start"><span data-icon="message"></span><h3>This is the start of your conversation</h3><p>A simple hello goes a long way.</p></div>';
      return;
    }
    messages.forEach(appendMessage);
  };

  // Create single message DOM element
  const createMessageElement = (msg) => {
    const isOwn = msg.sender_id === currentUser.id;
    const isDeleted = msg.is_deleted;
    const isLocal = typeof msg.id !== 'number';
    const bubble = document.createElement('div');
    bubble.className = `message-row ${isOwn ? 'message-own' : 'message-other'}`;
    bubble.id = `msg-${msg.id}`;

    const senderName = msg.sender ? (msg.sender.display_name || msg.sender.username) : 'User';
    const avatar = AppUI.avatarUrl(msg.sender?.avatar_url,senderName);
    const timeStr = Utils.formatMessageTime(msg.created_at);

    // Group message sender avatar
    const showAvatar = !isOwn && activeConversation && activeConversation.type === 'GROUP';

    // Reply preview
    let replyHtml = '';
    if (msg.reply_to) {
      replyHtml = `
        <button type="button" class="message-reply-quote" aria-label="Go to replied message">
          <div class="reply-sender">${Utils.escapeHTML(msg.reply_to.sender_name || 'User')}</div>
          <div class="reply-text">${Utils.escapeHTML(msg.reply_to.content)}</div>
        </button>
      `;
    }

    // Attachments
    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.length > 0 && !isDeleted) {
      attachmentsHtml = '<div class="message-attachments">';
      msg.attachments.forEach(att => {
        const fileUrl = API.resolveUrl(att.file_url);
        if (att.file_type.startsWith('image/')) {
          attachmentsHtml += `
            <a href="${Utils.escapeHTML(fileUrl)}" target="_blank" rel="noopener noreferrer" class="attachment-image-link">
              <img src="${Utils.escapeHTML(fileUrl)}" alt="${Utils.escapeHTML(att.file_name)}" class="attachment-image" loading="lazy" />
            </a>
          `;
        } else {
          attachmentsHtml += `
            <a href="${Utils.escapeHTML(fileUrl)}" target="_blank" rel="noopener noreferrer" download="${Utils.escapeHTML(att.file_name)}" class="attachment-file-card">
              <span class="file-icon">${AppUI.icon('file')}</span>
              <div class="file-info">
                <span class="file-name">${Utils.escapeHTML(att.file_name)}</span>
                <span class="file-size">${Utils.formatFileSize(att.file_size)}</span>
              </div>
              <span class="download-icon">${AppUI.icon('download')}</span>
            </a>
          `;
        }
      });
      attachmentsHtml += '</div>';
    }

    // Reactions display
    let reactionsHtml = '';
    if (msg.reactions && msg.reactions.length > 0) {
      // Group reactions by emoji
      const counts = {};
      msg.reactions.forEach(r => {
        counts[r.emoji] = (counts[r.emoji] || 0) + 1;
      });

      reactionsHtml = '<div class="message-reactions-list">';
      Object.keys(counts).forEach(emoji => {
        const hasReacted = msg.reactions.some(r => r.emoji === emoji && r.user_id === currentUser.id);
        reactionsHtml += `
          <button class="reaction-chip ${hasReacted ? 'active' : ''}" data-emoji="${Utils.escapeHTML(emoji)}">
            <span>${Utils.escapeHTML(emoji)}</span> <span class="rxn-count">${counts[emoji]}</span>
          </button>
        `;
      });
      reactionsHtml += '</div>';
    }

    // Status receipt ticks (for own messages)
    const receiptHtml = isOwn ? Utils.renderReceiptTicks(msg.status) : '';

    const sharedPost = !isDeleted && typeof msg.content === 'string' && msg.content.match(/^Shared post by ([^\n]+)\n([^\n]*)\n\/post\/(\d+)$/);
    const sharedReel = !isDeleted && typeof msg.content === 'string' && msg.content.match(/^Shared Reel by (@[A-Za-z0-9_]{3,30})\n([^\n]*)\n\/reels\.html\?id=([a-f0-9]{32})$/);
    const messageBody = sharedReel ? `<a class="chat-post-preview chat-reel-preview" data-reel-id="${sharedReel[3]}" href="reels.html?id=${sharedReel[3]}"><span>${AppUI.icon('video')} Shared Reel</span><strong>${Utils.escapeHTML(sharedReel[1])}</strong><small>${Utils.escapeHTML(sharedReel[2])}</small><em>Watch Reel ${AppUI.icon('arrow-right')}</em></a>` : sharedPost ? `<a class="chat-post-preview" href="social.html?view=post&id=${encodeURIComponent(sharedPost[3])}"><span>${AppUI.icon('messages')} Shared post</span><strong>${Utils.escapeHTML(sharedPost[1])}</strong><small>${Utils.escapeHTML(sharedPost[2])}</small><em>Open post ${AppUI.icon('arrow-right')}</em></a>` : AppUI.linkify(msg.content);
    bubble.innerHTML = `
      ${showAvatar ? `<img src="${Utils.escapeHTML(avatar)}" alt="${Utils.escapeHTML(senderName)}" class="message-sender-avatar" title="${Utils.escapeHTML(senderName)}" />` : ''}
      <div class="message-bubble ${isDeleted ? 'deleted-bubble' : ''}">
        ${showAvatar ? `<div class="message-sender-name">${Utils.escapeHTML(senderName)}</div>` : ''}
        ${replyHtml}
        ${attachmentsHtml}
        <div class="message-text">${isDeleted ? '<i>This message was deleted</i>' : messageBody}</div>
        <div class="message-meta">
          ${msg.is_edited && !isDeleted ? '<span class="edited-label">(edited)</span>' : ''}
          <span class="message-time">${timeStr}</span>
          ${receiptHtml}
        </div>
        ${reactionsHtml}

        ${!isDeleted && (msg.is_forwarded || msg.pinned_at || msg.expires_at || msg.thread_reply_count || msg.thread_root_id) ? `<div class="message-extra">${msg.is_forwarded ? '<span>Forwarded</span>' : ''}${msg.pinned_at ? '<span>Pinned</span>' : ''}${msg.expires_at ? '<span>Disappearing</span>' : ''}${msg.thread_root_id ? '<span>Thread reply</span>' : ''}${msg.thread_reply_count ? `<button class="message-thread-link" type="button">${msg.thread_reply_count} ${msg.thread_reply_count === 1 ? 'reply' : 'replies'} in thread</button>` : ''}</div>` : ''}

        ${msg.status === 'FAILED' ? '<div class="message-failure"><span>Message couldn’t be sent</span><button class="text-button btn-retry-message">Retry</button></div>' : ''}
        ${!isDeleted && !isLocal ? `
          <div class="message-actions-hover" aria-label="Message actions">
            <button class="action-icon-btn btn-quick-react" title="React" aria-label="React">${AppUI.icon('smile')}</button>
            <button class="action-icon-btn btn-reply" title="Reply" aria-label="Reply">${AppUI.icon('reply')}</button>
            <button class="action-icon-btn btn-copy" title="Copy message" aria-label="Copy message">${AppUI.icon('copy')}</button>
            <button class="action-icon-btn btn-forward" title="Forward" aria-label="Forward">${AppUI.icon('forward')}</button>
            <button class="action-icon-btn btn-thread" title="Open thread" aria-label="Open thread">${AppUI.icon('messages')}</button>
            <button class="action-icon-btn btn-more-message" title="More actions" aria-label="More message actions">${AppUI.icon('more')}</button>
            ${isOwn ? `<button class="action-icon-btn btn-edit" title="Edit" aria-label="Edit">${AppUI.icon('edit')}</button>` : ''}
            ${isOwn || (activeConversation?.type === 'GROUP' && isGroupAdmin(activeConversation)) ? `<button class="action-icon-btn btn-delete" title="Delete" aria-label="Delete">${AppUI.icon('trash')}</button>` : ''}
          </div>` : ''}
      </div>
    `;

    bubble.querySelector('.message-reply-quote')?.addEventListener('click', () => {
      const target = document.getElementById(`msg-${msg.reply_to.id}`);
      if (target) target.scrollIntoView({behavior:'smooth',block:'center'});
      else Utils.showToast('Load earlier messages to see the original reply.', 'info');
    });
    bubble.querySelectorAll('.attachment-image-link').forEach(link => link.onclick = e => {
      e.preventDefault(); const image = link.querySelector('img');
      document.getElementById('attachment-preview-image').src = image.src; document.getElementById('attachment-preview-image').alt = image.alt;
      document.getElementById('attachment-preview-download').href = link.href; document.getElementById('attachment-preview-title').textContent = image.alt;
      Utils.openModal('modal-attachment-preview');
    });
    bubble.querySelector('.message-bubble').tabIndex = 0;
    bubble.querySelector('.message-bubble').setAttribute('aria-label', `${isOwn ? 'You' : senderName}, ${isDeleted ? 'Message deleted' : msg.content || 'Attachment'}, ${timeStr}`);
    const reelCard = bubble.querySelector('.chat-reel-preview');
    if (reelCard) API.get(`/reels/${reelCard.dataset.reelId}`).then(reel => {
      if (!reelCard.isConnected || !reel.thumbnail_url) return;
      const cover = document.createElement('img'); cover.src = API.resolveUrl(reel.thumbnail_url);
      cover.alt = `Cover for Reel by ${reel.creator.username}`; cover.loading = 'lazy';
      reelCard.prepend(cover);
    }).catch(() => { if (reelCard.isConnected) reelCard.querySelector('em').textContent = 'Reel unavailable'; });
    bubble.querySelector('.btn-retry-message')?.addEventListener('click', () => dispatchMessage(msg));
    bubble.querySelector('.btn-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(msg.content); Utils.showToast('Copied to clipboard', 'success'); }
      catch { Utils.showToast('Copy is unavailable in this browser.', 'error'); }
    });
    bubble.querySelector('.btn-forward')?.addEventListener('click', () => setupForwardModal(msg));
    bubble.querySelector('.btn-thread')?.addEventListener('click', () => openThread(msg));
    bubble.querySelector('.message-thread-link')?.addEventListener('click', () => openThread(msg));
    bubble.querySelector('.btn-more-message')?.addEventListener('click', e => openMessageMenu(e.currentTarget,msg));
    bubble.querySelector('.message-bubble').addEventListener('contextmenu', e => { e.preventDefault(); bubble.classList.toggle('actions-visible'); });
    let longPress;
    bubble.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') longPress = setTimeout(() => bubble.classList.add('actions-visible'), 500); });
    ['pointerup','pointercancel','pointermove'].forEach(event => bubble.addEventListener(event, () => clearTimeout(longPress)));
    // Event handlers on message actions
    if (!isDeleted) {
      const btnReact = bubble.querySelector('.btn-quick-react');
      if (btnReact) {
        btnReact.addEventListener('click', (e) => {
          e.stopPropagation();
          showReactionMenu(msg.id, e.currentTarget);
        });
      }

      const btnReply = bubble.querySelector('.btn-reply');
      if (btnReply) {
        btnReply.addEventListener('click', () => setReplyTo(msg));
      }

      const btnEdit = bubble.querySelector('.btn-edit');
      if (btnEdit) {
        btnEdit.addEventListener('click', () => setEditing(msg));
      }

      const btnDelete = bubble.querySelector('.btn-delete');
      if (btnDelete) {
        btnDelete.addEventListener('click', () => confirmDeleteMessage(msg.id));
      }

      // Reaction chips click to toggle
      bubble.querySelectorAll('.reaction-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          toggleReaction(msg.id, chip.dataset.emoji);
        });
      });
    }

    return bubble;
  };

  const isGroupAdmin = (conv) => {
    if (!conv || conv.type !== 'GROUP') return false;
    const member = conv.members.find(m => m.user_id === currentUser.id);
    return member && member.role === 'ADMIN';
  };

  // Reply handlers
  const setReplyTo = (msg) => {
    hideEditPreview();
    replyingToMessage = msg;
    const sender = msg.sender ? (msg.sender.display_name || msg.sender.username) : 'User';
    elements.replyAuthor.textContent = sender;
    elements.replyContent.textContent = msg.content || 'Attachment';
    elements.replyPreviewBar.classList.remove('hidden');
    elements.messageInput.focus();
  };

  const hideReplyPreview = () => {
    replyingToMessage = null;
    elements.replyPreviewBar.classList.add('hidden');
  };

  // Edit handlers
  const setEditing = (msg) => {
    saveDraft();
    editingMessage = msg;
    hideReplyPreview();
    elements.editContent.textContent = msg.content;
    elements.editPreviewBar.classList.remove('hidden');
    elements.messageInput.value = msg.content;
    elements.messageInput.focus();
    syncComposer();
  };

  const hideEditPreview = () => {
    const wasEditing = !!editingMessage;
    editingMessage = null;
    elements.editPreviewBar.classList.add('hidden');
    if (wasEditing) elements.messageInput.value = drafts[activeConversation?.id]?.text || '';
    syncComposer();
  };

  // Delete message
  const confirmDeleteMessage = async (msgId) => {
    if (!await AppUI.confirm({title:'Delete this message?', description:'This message will be removed for everyone in this conversation.', action:'Delete message'})) return;
    try {
      const deleted = await API.delete(`/messages/${msgId}`);
      handleMessageEdited(deleted);
      Utils.showToast('Message deleted', 'info');
    } catch (err) {
      Utils.showToast(err.message, 'error');
    }
  };

  // Toggle reaction
  const toggleReaction = async (msgId, emoji) => {
    try {
      const updated = await API.post(`/messages/${msgId}/reaction`, { emoji });
      handleMessageEdited(updated);
    } catch (err) {
      Utils.showToast(err.message, 'error');
    }
  };

  // Show quick reaction popup
  const showReactionMenu = (msgId, triggerElement) => {
    // Remove any existing reaction popup
    const existing = document.querySelector('.quick-reaction-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.className = 'quick-reaction-popup';

    CONFIG.REACTION_EMOJIS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'reaction-menu-emoji';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        toggleReaction(msgId, emoji);
        popup.remove();
      });
      popup.appendChild(btn);
    });

    document.body.appendChild(popup);

    const rect = triggerElement.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    popup.style.top = `${Math.max(8, rect.top - box.height - 8)}px`;
    popup.style.left = `${Math.max(8, Math.min(rect.left - 30, innerWidth - box.width - 8))}px`;
    popup.setAttribute('role','group'); popup.setAttribute('aria-label','Choose a reaction');
    popup.querySelector('button')?.focus();

    // Close on click outside
    const closeListener = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', closeListener);
      }
    };
    setTimeout(() => document.addEventListener('click', closeListener), 50);
  };

  // REST returns a reliable acknowledgement; the same backend broadcasts existing socket events.
  const dispatchMessage = async entry => {
    if (entry.status === 'SENDING' && entry.requesting) return;
    entry.status = 'SENDING'; entry.requesting = true; saveOutbox();
    document.getElementById(`msg-${entry.id}`)?.replaceWith(createMessageElement(entry));
    try {
      const result = await API.post('/messages', entry.payload);
      outbox.delete(entry.id); saveOutbox();
      if (activeConversation?.id === entry.conversation_id) {
        messages = messages.filter(m => m.id !== entry.id);
        document.getElementById(`msg-${entry.id}`)?.remove();
      }
      handleIncomingMessage(result);
    } catch {
      entry.status = 'FAILED';
      document.getElementById(`msg-${entry.id}`)?.replaceWith(createMessageElement(entry));
      Utils.showToast('Message couldn’t be sent. Use Retry to send it again.', 'error');
    } finally { entry.requesting = false; saveOutbox(); }
  };
  const queueMessage = payload => {
    const entry = {...payload, payload, id: `local-${crypto.randomUUID()}`, sender_id: currentUser.id, sender: currentUser, created_at: new Date().toISOString(), status:'SENDING', reactions:[], attachments:payload.attachments || []};
    outbox.set(entry.id,entry); saveOutbox();
    if (activeConversation?.id === payload.conversation_id) {
      if (viewingSearchHistory()) { document.getElementById('history-context').classList.add('hidden'); loadMessageHistory(activeConversation); }
      messages.push(entry); appendMessage(entry); scrollToBottom(true);
    }
    return dispatchMessage(entry);
  };
  const sendMessage = async () => {
    if (!activeConversation || uploading) return;
    const content = elements.messageInput.value.trim();
    if (!content && !pendingAttachments.length) return;
    if (content.length > 10000) { Utils.showToast('Please keep messages under 10,000 characters.', 'warning'); return; }
    if (editingMessage) {
      const editingId = editingMessage.id; const convId = activeConversation.id;
      elements.btnSendMessage.disabled = true;
      try {
        const result = await API.put(`/messages/${editingId}`, {content}); handleMessageEdited(result);
        if (activeConversation?.id === convId && editingMessage?.id === editingId) { hideEditPreview(); saveDraft(); }
      } catch { Utils.showToast('Your edit couldn’t be saved. Please try again.', 'error'); }
      finally { syncComposer(); }
      return;
    }
    const payload = {
      conversation_id: activeConversation.id, content: content || '',
      message_type: pendingAttachments.length ? pendingAttachments[0].file_type.startsWith('image/') ? 'IMAGE' : 'FILE' : 'TEXT',
      reply_to_id: replyingToMessage?.id || null,
      expires_in_seconds: Number(document.getElementById('message-expiry').value) || null,
      attachments: pendingAttachments.map(({file_url,file_name,file_type,file_size,public_id}) => ({file_url,file_name,file_type,file_size,public_id}))
    };
    elements.messageInput.value = ''; document.getElementById('message-expiry').value = ''; pendingAttachments = []; renderAttachmentPreviews(); hideReplyPreview(); stopTyping(); saveDraft(); syncComposer(); renderConversationsList();
    await queueMessage(payload);
  };
  const setupForwardModal = msg => {
    forwardingMessage = msg;
    Utils.openModal('modal-forward');
    const list = document.getElementById('forward-conversations'); list.innerHTML = '';
    if (!conversations.length) { list.innerHTML = '<p class="empty-list-notice">Start a conversation first.</p>'; return; }
    conversations.forEach(conv => {
      const label = document.createElement('label'); label.className = 'forward-target';
      label.innerHTML = `<input type="checkbox" value="${conv.id}" name="destination"><img src="${Utils.escapeHTML(chatAvatar(conv))}" alt="" /><span>${Utils.escapeHTML(chatName(conv))}</span>`;
      list.append(label);
    });
  };
  const threadItem = msg => `<div class="thread-item" data-thread-message="${msg.id}"><strong>${Utils.escapeHTML(msg.sender?.display_name || msg.sender?.username || 'Member')}</strong><div>${msg.is_deleted ? 'This message was deleted' : AppUI.linkify(msg.content)}</div><small>${Utils.formatMessageTime(msg.created_at)}</small></div>`;
  const loadThreadPage = async offset => {
    const list = document.getElementById('thread-replies');
    list.querySelector('.thread-load-more')?.remove();
    try {
      const rows = await API.get(`/messages/${threadRoot.id}/thread`, {limit:30, offset});
      if (offset === 0) list.innerHTML = rows.length ? '' : '<p class="empty-list-notice">No replies yet. Start the thread.</p>';
      rows.forEach(row => {
        threadMessageIds.add(row.id);
        list.insertAdjacentHTML('beforeend', threadItem(row));
      });
      if (rows.length === 30) {
        const button = document.createElement('button');
        button.className = 'btn btn-secondary thread-load-more'; button.textContent = 'Load more replies';
        button.onclick = () => loadThreadPage(offset + rows.length);
        list.append(button);
      }
    } catch (error) { list.insertAdjacentHTML('beforeend', `<p class="empty-list-notice">${Utils.escapeHTML(error.message)}</p>`); }
  };
  const openThread = async msg => {
    threadRoot = msg.thread_root_id ? messages.find(m => m.id === msg.thread_root_id) || await API.get(`/messages/${msg.thread_root_id}`) : msg;
    Utils.openModal('modal-thread');
    document.getElementById('thread-root').innerHTML = `<strong>${Utils.escapeHTML(threadRoot.sender?.display_name || threadRoot.sender?.username || 'Member')}</strong><div>${AppUI.linkify(threadRoot.content || 'Attachment')}</div>`;
    const list = document.getElementById('thread-replies'); list.innerHTML = '<p class="empty-list-notice">Loading replies…</p>';
    await loadThreadPage(0);
  };
  const openMessageMenu = (trigger, msg) => {
    const choices = [
      {label:msg.bookmarked ? 'Remove saved message' : 'Save message',icon:'bookmark',run:async()=>{
        const updated = msg.bookmarked ? await API.delete(`/messages/${msg.id}/bookmark`) : await API.post(`/messages/${msg.id}/bookmark`,{});
        msg.bookmarked = updated.bookmarked; Utils.showToast(msg.bookmarked ? 'Message saved' : 'Message removed from saved','success');
      }},
      {label:'Copy message link',icon:'copy',run:async()=>{ await navigator.clipboard.writeText(`${location.origin}/chat.html?conversation=${msg.conversation_id}&message=${msg.id}`); Utils.showToast('Message link copied','success'); }},
      {label:'Report message',icon:'alert-circle',run:()=>{ reportingMessageId = msg.id; Utils.openModal('modal-report-message'); }}
    ];
    if (activeConversation?.type === 'DIRECT' || isGroupAdmin(activeConversation)) choices.unshift({
      label:msg.pinned_at ? 'Unpin message' : 'Pin message',icon:'pin',run:async()=>{
        const updated = msg.pinned_at ? await API.delete(`/messages/${msg.id}/pin`) : await API.post(`/messages/${msg.id}/pin`,{});
        msg.pinned_at = updated.pinned_at; document.getElementById(`msg-${msg.id}`)?.replaceWith(createMessageElement(msg));
      }});
    AppUI.showMenu(trigger,choices,'Message actions');
  };
  const openSavedMessages = async () => {
    Utils.openModal('modal-saved-messages'); const list = document.getElementById('saved-messages-list'); list.textContent = 'Loading…';
    try { const rows = await API.get('/messages/bookmarks');
      list.innerHTML = rows.length ? rows.map(msg => `<button class="saved-message-row" data-conversation="${msg.conversation_id}" data-message="${msg.id}">${Utils.escapeHTML(msg.content || 'Attachment')}<small>${Utils.formatMessageTime(msg.created_at)}</small></button>`).join('') : '<p class="empty-list-notice">No saved messages yet.</p>';
      list.querySelectorAll('button').forEach((button,index) => button.onclick = async () => {
        Utils.closeModal('modal-saved-messages'); const msg = rows[index];
        const conv = conversations.find(c => c.id === msg.conversation_id); if (!conv) return;
        await selectConversation(conv);
        if (msg.thread_root_id) { await openThread(msg); return; }
        if (!messages.some(item => item.id === msg.id)) {
          const older = await API.get(`/messages/conversation/${conv.id}`,{before_id:msg.id+1,limit:50});
          messages = older; renderMessages(); document.getElementById('history-context').classList.remove('hidden');
        }
        document.getElementById(`msg-${msg.id}`)?.scrollIntoView({block:'center'});
      });
    } catch (error) { list.textContent = error.message; }
  };
  const openScheduledMessages = async () => {
    Utils.openModal('modal-scheduled-messages'); const list = document.getElementById('scheduled-messages-list'); list.textContent = 'Loading…';
    try { const rows = await API.get('/messages/scheduled');
      list.innerHTML = rows.length ? rows.map(item => `<div class="schedule-row"><div>${Utils.escapeHTML(item.content)}<small>${new Date(item.send_at).toLocaleString()}</small></div><button class="btn btn-secondary" data-id="${item.id}">Cancel</button></div>`).join('') : '<p class="empty-list-notice">No scheduled messages.</p>';
      list.querySelectorAll('button').forEach(button => button.onclick = async () => { try { await API.delete(`/messages/scheduled/${button.dataset.id}`); button.closest('.schedule-row').remove(); Utils.showToast('Scheduled message cancelled','success'); } catch (error) { Utils.showToast(error.message,'info'); openScheduledMessages(); } });
    } catch (error) { list.textContent = error.message; }
  };

  // Scroll messages container to bottom
  const scrollToBottom = (smooth = false) => {
    if (!elements.messagesContainer) return;
    elements.messagesContainer.scrollTo({
      top: elements.messagesContainer.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  };

  // Typing event handling
  const handleKeystroke = () => {
    if (!activeConversation) return;

    if (!isTyping) {
      isTyping = true;
      WSClient.sendTypingStart(activeConversation.id);
    }

    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 2500);
  };

  const stopTyping = () => {
    if (isTyping && activeConversation) {
      isTyping = false;
      WSClient.sendTypingStop(activeConversation.id);
    }
    clearTimeout(typingTimer);
  };

  const showTypingIndicator = (name) => {
    elements.typingText.textContent = `${name} is typing`;
    elements.typingIndicator.classList.remove('hidden');
    scrollToBottom(true);
  };

  const hideTypingIndicator = () => {
    elements.typingIndicator.classList.add('hidden');
  };

  // Deduplicate REST acknowledgements and socket echoes; preserve the reader’s scroll position.
  const handleIncomingMessage = msg => {
    if (msg.thread_root_id) {
      if (threadMessageIds.has(msg.id)) return;
      threadMessageIds.add(msg.id);
      const root = messages.find(m => m.id === msg.thread_root_id);
      if (root) {
        root.thread_reply_count = (root.thread_reply_count || 0) + 1;
        document.getElementById(`msg-${root.id}`)?.replaceWith(createMessageElement(root));
      }
      if (threadRoot?.id === msg.thread_root_id) {
        document.querySelector('#thread-replies .empty-list-notice')?.remove();
        const more = document.querySelector('#thread-replies .thread-load-more');
        if (more) more.insertAdjacentHTML('beforebegin',threadItem(msg));
        else document.getElementById('thread-replies').insertAdjacentHTML('beforeend',threadItem(msg));
      }
      if (activeConversation?.id === msg.conversation_id && msg.sender_id !== currentUser.id) markRead(activeConversation);
      return;
    }
    const exists = messages.find(m => m.id === msg.id);
    if (activeConversation?.id === msg.conversation_id && !exists && !viewingSearchHistory()) {
      const nearBottom = elements.messagesContainer.scrollHeight - elements.messagesContainer.scrollTop - elements.messagesContainer.clientHeight < 160;
      messages.push(msg);
      appendMessage(msg);
      if (msg.sender_id === currentUser.id || nearBottom) scrollToBottom(true);
      else document.getElementById('btn-jump-latest').classList.remove('hidden');
      if (msg.sender_id !== currentUser.id) markRead(activeConversation);
      if (elements.modalGroupInfo.classList.contains('active')) renderSharedContent();
    }
    if (activeConversation?.id === msg.conversation_id && viewingSearchHistory()) document.getElementById('btn-jump-latest').classList.remove('hidden');
    const index = conversations.findIndex(c => c.id === msg.conversation_id);
    const conv = conversations[index];
    if (conv) {
      if (conv.last_message?.id !== msg.id) {
        conv.last_message = msg;
        if (!visibleChat(conv.id) && msg.sender_id !== currentUser.id) {
          conv.unread_count = (conv.unread_count || 0) + 1;
          if (!pref(conv.id).muted) Notifications.notifyNewMessage(msg, chatName(conv), () => selectConversation(conv));
        }
        conversations.splice(index,1); conversations.unshift(conv);
      }
      renderConversationsList();
    } else loadConversations();
  };

  const handleMessageEdited = (msg) => {
    const conv = conversations.find(c => c.last_message?.id === msg.id);
    if (conv) { conv.last_message = msg; renderConversationsList(); }
    const idx = messages.findIndex(m => m.id === msg.id);
    if (idx !== -1) {
      messages[idx] = msg;
    }
    const el = document.getElementById(`msg-${msg.id}`);
    if (el) {
      const newEl = createMessageElement(msg);
      el.replaceWith(newEl);
    }
    if (elements.modalGroupInfo.classList.contains('active')) renderSharedContent();
  };

  const handleMessageDeleted = (data) => {
    const conv = conversations.find(c => c.last_message?.id === data.id);
    if (conv) { conv.last_message = {...conv.last_message,is_deleted:true,content:'This message was deleted',attachments:[]}; renderConversationsList(); }
    const idx = messages.findIndex(m => m.id === data.id);
    if (idx !== -1) {
      messages[idx].is_deleted = true;
      messages[idx].content = 'This message was deleted';
      messages[idx].attachments = [];
    }
    const el = document.getElementById(`msg-${data.id}`);
    if (el && idx !== -1) {
      const newEl = createMessageElement(messages[idx]);
      el.replaceWith(newEl);
    }
    if (elements.modalGroupInfo.classList.contains('active')) renderSharedContent();
  };

  const handleReactionUpdate = (data) => {
    const msg = messages.find(m => m.id === data.message_id);
    if (msg) {
      msg.reactions = data.reactions;
      const el = document.getElementById(`msg-${msg.id}`);
      if (el) {
        const newEl = createMessageElement(msg);
        el.replaceWith(newEl);
      }
    }
  };

  const handleReadReceipt = data => {
    if (activeConversation?.id !== data.conversation_id || data.user_id === currentUser.id) return;
    messages.forEach(m => {
      if (m.sender_id !== currentUser.id || !data.message_ids?.includes(m.id)) return;
      m.read_by = [...new Set([...(m.read_by || []), data.user_id])];
      m.status = 'READ'; document.getElementById(`msg-${m.id}`)?.replaceWith(createMessageElement(m));
    });
  };
  const updateUserPresence = (userId, isOnline, lastSeen) => {
    conversations.forEach(conv => {
      if (conv.other_user?.id === userId) { conv.other_user.is_online = isOnline; if (lastSeen) conv.other_user.last_seen = lastSeen; }
    });
    if (activeConversation?.other_user?.id === userId) { activeConversation.other_user.is_online = isOnline; if (lastSeen) activeConversation.other_user.last_seen = lastSeen; updateChatHeader(); }
    renderConversationsList();
  };

  // Attachment handling
  const handleFileUpload = async file => {
    if (!file || !activeConversation) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!CONFIG.ALLOWED_EXTENSIONS.includes(ext)) { Utils.showToast('This file type isn’t supported.', 'error'); return; }
    if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) { Utils.showToast(`Choose a file smaller than ${CONFIG.MAX_FILE_SIZE_MB} MB.`, 'error'); return; }
    const convId = activeConversation.id;
    uploading++; syncComposer(); document.getElementById('upload-status').classList.remove('hidden');
    try {
      const uploaded = await API.uploadFile(file);
      if (activeConversation?.id === convId) { pendingAttachments.push(uploaded); renderAttachmentPreviews(); saveDraft(); }
      else { drafts[convId] ||= {text:'',attachments:[]}; drafts[convId].attachments.push(uploaded); AppUI.write(draftKey,drafts); }
      Utils.showToast('File ready to send', 'success');
    } catch { Utils.showToast('File couldn’t be uploaded. Please try again.', 'error'); }
    finally { uploading--; syncComposer(); document.getElementById('upload-status').classList.toggle('hidden', !uploading); }
  };

  const renderAttachmentPreviews = () => {
    syncComposer();
    if (pendingAttachments.length === 0) {
      elements.attachmentPreviewBar.classList.add('hidden');
      elements.attachmentPreviews.innerHTML = '';
      return;
    }

    elements.attachmentPreviewBar.classList.remove('hidden');
    elements.attachmentPreviews.innerHTML = '';

    pendingAttachments.forEach((att, index) => {
      const item = document.createElement('div');
      item.className = 'attachment-chip';
      item.innerHTML = `
        <span class="chip-name">${Utils.escapeHTML(att.file_name)}</span>
        <button class="chip-remove icon-btn" data-index="${index}" aria-label="Remove ${Utils.escapeHTML(att.file_name)}">${AppUI.icon('x')}</button>
      `;
      item.querySelector('.chip-remove').addEventListener('click', () => {
        pendingAttachments.splice(index, 1);
        renderAttachmentPreviews(); saveDraft();
      });
      elements.attachmentPreviews.appendChild(item);
    });
  };

  // Event Listeners for UI
  const bindUIEvents = () => {
    document.getElementById('btn-empty-new-chat').onclick = setupNewChatModal;
    document.getElementById('btn-details').onclick = () => elements.modalGroupInfo.classList.contains('active') ? Utils.closeModal('modal-group-info') : setupChatInfoModal();
    document.getElementById('btn-chat-options').onclick = e => { if (activeConversation) openChatMenu(e.currentTarget,activeConversation); };
    document.getElementById('btn-global-search').onclick = () => setupSearchMessagesModal();
    document.getElementById('btn-clear-conversation-search').onclick = () => { elements.convSearchInput.value = ''; renderConversationsList(); elements.convSearchInput.focus(); };
    document.getElementById('btn-load-earlier').onclick = loadEarlierMessages;
    document.getElementById('btn-jump-latest').onclick = () => { if (viewingSearchHistory()) { document.getElementById('history-context').classList.add('hidden'); loadMessageHistory(activeConversation); } else scrollToBottom(true); document.getElementById('btn-jump-latest').classList.add('hidden'); };
    elements.messagesContainer.addEventListener('scroll', () => {
      if (elements.messagesContainer.scrollHeight - elements.messagesContainer.scrollTop - elements.messagesContainer.clientHeight < 100) document.getElementById('btn-jump-latest').classList.add('hidden');
    }, {passive:true});
    document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active',b === button); b.setAttribute('aria-pressed',String(b === button)); });
      renderConversationsList();
    });
    document.getElementById('nav-stories').onclick = async () => {
      const tray = document.getElementById('stories-tray-container'); const show = tray.classList.contains('hidden');
      tray.classList.toggle('hidden',!show); document.getElementById('nav-stories').classList.toggle('active',show);
      document.getElementById('nav-stories').setAttribute('aria-pressed',String(show));
      if (show) await Stories.loadStories();
    };
    document.getElementById('nav-messages').onclick = () => { if (innerWidth <= 768) document.body.classList.remove('mobile-chat-open'); elements.convSearchInput.focus(); };
    document.addEventListener('visibilitychange', () => { if (activeConversation && document.visibilityState === 'visible') markRead(activeConversation); });
    window.addEventListener('beforeunload',saveDraft);
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setupSearchMessagesModal(); }
      if (e.key === 'Escape') { elements.emojiPickerPopup.classList.add('hidden'); document.querySelectorAll('.actions-visible').forEach(el => el.classList.remove('actions-visible')); document.querySelector('.quick-reaction-popup')?.remove(); }
    });
    // Send button click
    elements.btnSendMessage.addEventListener('click', sendMessage);
    document.getElementById('btn-schedule-message').onclick = () => {
      if (!activeConversation || !elements.messageInput.value.trim()) { Utils.showToast('Write a message before scheduling.','info'); return; }
      if (pendingAttachments.length) { Utils.showToast('Scheduled attachments are not available yet.','info'); return; }
      const input = document.getElementById('schedule-at');
      const soon = new Date(Date.now() + 60_000); input.min = `${soon.getFullYear()}-${String(soon.getMonth()+1).padStart(2,'0')}-${String(soon.getDate()).padStart(2,'0')}T${String(soon.getHours()).padStart(2,'0')}:${String(soon.getMinutes()).padStart(2,'0')}`;
      input.value = input.min; Utils.openModal('modal-schedule');
    };
    document.getElementById('schedule-form').onsubmit = async event => {
      event.preventDefault(); const button = event.target.querySelector('[type=submit]'); button.disabled = true;
      try { await API.post('/messages/scheduled',{conversation_id:activeConversation.id,
        content:elements.messageInput.value.trim(),send_at:new Date(document.getElementById('schedule-at').value).toISOString(),
        reply_to_id:replyingToMessage?.id || null});
        elements.messageInput.value = ''; hideReplyPreview(); saveDraft(); syncComposer(); Utils.closeModal('modal-schedule'); Utils.showToast('Message scheduled','success'); }
      catch (error) { Utils.showToast(error.message,'error'); } finally { button.disabled = false; }
    };
    document.getElementById('forward-form').onsubmit = async event => {
      event.preventDefault(); const ids = [...event.target.querySelectorAll('[name=destination]:checked')].map(input => Number(input.value));
      if (!ids.length || ids.length > 10) { Utils.showToast('Choose 1 to 10 conversations.','warning'); return; }
      const button = event.target.querySelector('[type=submit]'); button.disabled = true;
      try { await API.post(`/messages/${forwardingMessage.id}/forward`,{conversation_ids:ids}); Utils.closeModal('modal-forward'); Utils.showToast(`Forwarded to ${ids.length} ${ids.length === 1 ? 'conversation' : 'conversations'}`,'success'); }
      catch (error) { Utils.showToast(error.message,'error'); } finally { button.disabled = false; }
    };
    document.getElementById('thread-form').onsubmit = async event => {
      event.preventDefault(); if (!threadRoot || !activeConversation) return;
      const input = document.getElementById('thread-input'); const value = input.value.trim(); if (!value) return;
      const button = event.target.querySelector('[type=submit]'); button.disabled = true;
      try { const reply = await API.post('/messages',{conversation_id:activeConversation.id,content:value,
        thread_root_id:threadRoot.thread_root_id || threadRoot.id,reply_to_id:threadRoot.id});
        input.value = ''; handleIncomingMessage(reply); }
      catch (error) { Utils.showToast(error.message,'error'); } finally { button.disabled = false; }
    };
    document.getElementById('report-message-form').onsubmit = async event => {
      event.preventDefault(); if (!reportingMessageId) return;
      const button = event.target.querySelector('[type=submit]'); button.disabled = true;
      try { await API.post('/social/reports',{entity_type:'message',entity_id:reportingMessageId,
        reason:document.getElementById('message-report-reason').value});
        Utils.closeModal('modal-report-message'); Utils.showToast('Report submitted','success'); }
      catch (error) { Utils.showToast(error.message,'error'); } finally { button.disabled = false; }
    };

    // Message input enter key
    elements.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Keystroke for typing indicator
    elements.messageInput.addEventListener('input', () => { handleKeystroke(); syncComposer(); saveDraft(); });

    // Cancel reply / edit
    elements.btnCancelReply.addEventListener('click', hideReplyPreview);
    elements.btnCancelEdit.addEventListener('click', hideEditPreview);

    // Attachment button
    elements.btnAttachment.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        [...e.target.files].forEach(handleFileUpload);
        e.target.value = '';
      }
    });

    // Emoji picker toggle
    elements.btnEmoji.addEventListener('click', (e) => {
      e.stopPropagation();
      elements.emojiPickerPopup.classList.toggle('hidden');
    });

    // Pick emoji
    Utils.$$('.emoji-btn', elements.emojiPickerPopup).forEach(btn => {
      btn.addEventListener('click', () => {
        elements.messageInput.value += btn.textContent;
        elements.messageInput.focus();
        elements.emojiPickerPopup.classList.add('hidden');
        handleKeystroke(); syncComposer(); saveDraft();
      });
    });

    document.addEventListener('click', (e) => {
      if (!elements.emojiPickerPopup.contains(e.target) && e.target !== elements.btnEmoji) {
        elements.emojiPickerPopup.classList.add('hidden');
      }
    });

    // Mobile back button
    elements.btnMobileBack.addEventListener('click', () => {
      saveDraft(); stopTyping(); Utils.closeModal('modal-group-info');
      document.body.classList.remove('mobile-chat-open');
      renderConversationsList();
    });

    // Live search in conversations sidebar
    elements.convSearchInput.addEventListener('input', Utils.debounce(renderConversationsList, 200));

    // Logout button
    elements.btnLogout.addEventListener('click', async () => {
      if (await AppUI.confirm({title:'Sign out of Relay?', description:'Your conversations will be here when you return.', action:'Sign out', danger:false})) {
        Auth.logout();
      }
    });

    // Modal triggers
    elements.btnNewChat.addEventListener('click', () => setupNewChatModal());
    elements.btnNewGroup.addEventListener('click', () => setupNewGroupModal());
    elements.btnSettings.addEventListener('click', () => setupSettingsModal());

    // Voice & Video Call triggers
    if (elements.btnVoiceCall) {
      elements.btnVoiceCall.addEventListener('click', () => {
        if (activeConversation && activeConversation.other_user) {
          Calls.startCall(activeConversation.other_user, 'audio');
        }
      });
    }

    if (elements.btnVideoCall) {
      elements.btnVideoCall.addEventListener('click', () => {
        if (activeConversation && activeConversation.other_user) {
          Calls.startCall(activeConversation.other_user, 'video');
        }
      });
    }

    // Story creation trigger
    if (elements.btnAddStory) {
      elements.btnAddStory.addEventListener('click', () => {
        Utils.openModal('modal-create-story');
      });
    }
    elements.btnSearchMessages.addEventListener('click', () => setupSearchMessagesModal(activeConversation?.id));
    elements.btnChatInfo.addEventListener('click', () => setupChatInfoModal());

    // Generic modal close buttons
    Utils.$$('.modal-close, .btn-modal-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) { modal.classList.remove('active'); if (modal.id === 'modal-thread') threadRoot = null; }
      });
    });

    syncComposer();
  };

  // --- Modal: New Direct Chat ---
  const setupNewChatModal = () => {
    Utils.openModal('modal-new-chat');
    const input = Utils.$('#search-users-input');
    const resultsContainer = Utils.$('#user-search-results');
    input.value = '';
    resultsContainer.innerHTML = '<div class="empty-list-notice">Search by username or display name</div>';

    input.oninput = Utils.debounce(async () => {
      const q = input.value.trim();
      if (!q) {
        resultsContainer.innerHTML = '<div class="empty-list-notice">Search by username or display name</div>';
        return;
      }
      resultsContainer.innerHTML = '<div class="empty-list-notice">Searching...</div>';
      try {
        const users = await Users.search(q);
        if (input.value.trim() !== q) return;
        if (users.length === 0) {
          resultsContainer.innerHTML = '<div class="empty-list-notice">No users found</div>';
          return;
        }
        resultsContainer.innerHTML = '';
        users.forEach(u => {
          const item = Users.renderUserItem(u, async (selectedUser) => {
            Utils.closeModal('modal-new-chat');
            try {
              const conv = await API.post('/conversations/direct', { recipient_id: selectedUser.id });
              await loadConversations();
              selectConversation(conv);
            } catch (err) {
              Utils.showToast(err.message, 'error');
            }
          });
          resultsContainer.appendChild(item);
        });
      } catch (err) {
        resultsContainer.innerHTML = `<div class="empty-list-notice error-text">${Utils.escapeHTML(err.message)}</div>`;
      }
    }, 250);
  };

  // --- Modal: New Group ---
  const setupNewGroupModal = async () => {
    Utils.openModal('modal-new-group');
    const groupNameInput = Utils.$('#new-group-name');
    const groupDescInput = Utils.$('#new-group-desc');
    const memberChecklist = Utils.$('#group-member-checklist');
    const btnCreate = Utils.$('#btn-create-group-submit');

    groupNameInput.value = '';
    groupDescInput.value = '';
    memberChecklist.innerHTML = '<div class="empty-list-notice">Loading contacts...</div>';

    // Populate contacts from existing direct conversations
    const contacts = [];
    conversations.forEach(c => {
      if (c.type === 'DIRECT' && c.other_user) {
        contacts.push(c.other_user);
      }
    });

    if (contacts.length === 0) {
      memberChecklist.innerHTML = '<div class="empty-list-notice">No contacts yet. You can add members after creating the group.</div>';
    } else {
      memberChecklist.innerHTML = '';
      contacts.forEach(u => {
        const label = document.createElement('label');
        label.className = 'member-check-item';
        label.innerHTML = `
          <input type="checkbox" value="${u.id}" class="member-checkbox" />
          <img src="${AppUI.avatarUrl(u.avatar_url,u.display_name || u.username)}" class="user-avatar-sm" />
          <span>${Utils.escapeHTML(u.display_name || u.username)}</span>
        `;
        memberChecklist.appendChild(label);
      });
    }

    btnCreate.onclick = async () => {
      const name = groupNameInput.value.trim();
      if (!name) {
        Utils.showToast('Please provide a group name', 'warning');
        return;
      }

      const selectedIds = Utils.$$('.member-checkbox:checked', memberChecklist).map(cb => parseInt(cb.value));

      if (name.length > 100) { Utils.showToast('Use a group name under 100 characters.', 'warning'); return; }
      btnCreate.disabled = true;
      try {
        const newGroup = await Groups.create(name, selectedIds, groupDescInput.value.trim());
        Utils.closeModal('modal-new-group');
        Utils.showToast(`Group "${name}" created!`, 'success');
        await loadConversations();
        selectConversation(newGroup);
      } catch (err) {
        Utils.showToast(err.message, 'error');
      } finally { btnCreate.disabled = false; }
    };
  };

  // Search uses the existing contacts and message endpoints, plus the loaded conversation index.
  const setupSearchMessagesModal = (scope = null, initial = '') => {
    Utils.openModal('modal-search-messages');
    const input = document.getElementById('search-query-input');
    const results = document.getElementById('search-messages-results');
    const tabs = [...document.querySelectorAll('[data-search-type]')];
    const recentKey = `relay-searches-${currentUser.id}`;
    let type = scope ? 'messages' : 'chats';
    let request = 0;
    let searchOffset = 0;
    input.value = initial;
    document.getElementById('search-dialog-title').textContent = scope ? `Search in ${chatName(activeConversation)}` : 'Find a conversation';
    input.placeholder = scope ? 'Search this conversation…' : 'Search people, chats, or messages…';
    document.getElementById('search-type-tabs').classList.toggle('hidden',!!scope);
    const saveRecent = q => {
      if (q) AppUI.write(recentKey, [q, ...AppUI.read(recentKey,[]).filter(v => v !== q)].slice(0,5));
    };
    const empty = () => {
      document.getElementById('btn-clear-message-search').classList.add('hidden');
      const recent = AppUI.read(recentKey,[]);
      results.innerHTML = '<div class="search-hint"><span data-icon="search"></span><p>Find your people. Pick up a conversation.</p><small>Search a name, username, or something you remember.</small></div>';
      if (recent.length) {
        results.innerHTML += '<div class="search-section-heading"><span>Recent searches</span><button id="btn-clear-recent-searches" class="text-button">Clear</button></div>';
        recent.forEach(q => { const button = document.createElement('button'); button.className = 'recent-search'; button.innerHTML = AppUI.icon('clock'); const label = document.createElement('span'); label.textContent = q; button.append(label); button.onclick = () => { input.value = q; search(); }; results.append(button); });
        document.getElementById('btn-clear-recent-searches').onclick = () => { AppUI.write(recentKey,[]); empty(); };
      }
    };
    const search = async (append = false) => {
      const q = input.value.trim(); const req = ++request;
      tabs.forEach(tab => { tab.classList.toggle('active',tab.dataset.searchType === type); tab.setAttribute('aria-pressed',String(tab.dataset.searchType === type)); });
      document.getElementById('message-search-filters').classList.toggle('hidden',type !== 'messages');
      const sender = document.getElementById('search-sender').value.trim().replace(/^@/,'');
      const has = document.getElementById('search-has').value;
      const after = document.getElementById('search-after').value;
      const before = document.getElementById('search-before').value;
      if (!q && !(type === 'messages' && (sender || has || after || before))) { empty(); return; }
      document.getElementById('btn-clear-message-search').classList.remove('hidden');
      if (!append) { searchOffset = 0; results.innerHTML = '<div class="skeleton-row" aria-label="Searching"></div><div class="skeleton-row"></div>'; }
      else results.querySelector('.search-more')?.remove();
      try {
        const messageParams = {q, limit:30, offset:searchOffset};
        if (scope) messageParams.conversation_id = scope;
        if (sender) messageParams.sender = sender;
        if (has) messageParams.has = has;
        if (after) messageParams.after = after;
        if (before) messageParams.before = before;
        const matches = type === 'contacts' ? await Users.search(q) : type === 'messages' ? await API.get('/search/messages',messageParams) : conversations.filter(conv => `${chatName(conv)} ${conv.other_user?.username || ''}`.toLowerCase().includes(q.toLowerCase()));
        if (req !== request || input.value.trim() !== q) return;
        const visible = matches;
        if (!append) results.innerHTML = '';
        if (!visible.length) { if (!append) results.innerHTML = `<div class="list-empty"><span data-icon="search"></span><h3>No ${type} found</h3><p>Try a different name or keyword.</p></div>`; return; }
        visible.forEach(match => {
          if (type === 'contacts') {
            const item = Users.renderUserItem(match, async user => {
              saveRecent(q); Utils.closeModal('modal-search-messages');
              try { const conv = await API.post('/conversations/direct',{recipient_id:user.id}); await loadConversations(); await selectConversation(conv); }
              catch { Utils.showToast('This conversation couldn’t be opened. Please try again.', 'error'); }
            });
            item.querySelector('.user-name').innerHTML = AppUI.highlight(match.display_name || match.username,q);
            item.querySelector('.user-handle').innerHTML = AppUI.highlight('@'+match.username,q);
            results.append(item); return;
          }
          const item = document.createElement('button'); item.className = 'search-result-item';
          if (type === 'chats') {
            item.innerHTML = `<img class="user-avatar-sm" src="${Utils.escapeHTML(chatAvatar(match))}" alt="" /><span><span class="result-conv-name">${AppUI.highlight(chatName(match),q)}</span><span class="result-content">${Utils.escapeHTML(match.last_message?.content || 'Start a conversation')}</span></span>${AppUI.icon('arrow-right')}`;
            item.onclick = () => { saveRecent(q); Utils.closeModal('modal-search-messages'); selectConversation(match); };
          } else {
            const conv = conversations.find(c => c.id === match.conversation_id);
            item.innerHTML = `<span><span class="result-conv-name">${Utils.escapeHTML(conv ? chatName(conv) : match.conversation_name)}</span><span class="result-content">${AppUI.highlight(match.content,q)}</span><span class="result-time">${Utils.escapeHTML(match.sender_name)} · ${Utils.formatDateHeader(match.created_at)} · ${Utils.formatMessageTime(match.created_at)}</span></span>${AppUI.icon('arrow-right')}`;
            item.onclick = async () => {
              if (!conv) return;
              saveRecent(q); Utils.closeModal('modal-search-messages'); await selectConversation(conv);
              if (activeConversation?.id !== conv.id) return;
              if (!document.getElementById(`msg-${match.message_id}`)) {
                try {
                  const history = await API.get(`/messages/conversation/${conv.id}`,{limit:50,before_id:match.message_id + 1});
                  if (activeConversation?.id !== conv.id) return;
                  messages = history; hasEarlier = history.length === 50; renderMessages();
                  document.getElementById('btn-load-earlier').classList.toggle('hidden',!hasEarlier);
                  document.getElementById('history-context').classList.remove('hidden');
                } catch { Utils.showToast('This message couldn’t be loaded. Please try again.', 'error'); return; }
              }
              const target = document.getElementById(`msg-${match.message_id}`);
              target?.scrollIntoView({behavior:'smooth',block:'center'}); target?.classList.add('message-highlight');
              setTimeout(() => target?.classList.remove('message-highlight'),2000);
            };
          }
          results.append(item);
        });
        if (type === 'messages') { searchOffset += visible.length; if (visible.length === 30) {
          const more = document.createElement('button'); more.className = 'btn btn-secondary search-more'; more.textContent = 'Load more messages';
          more.onclick = () => search(true); results.append(more);
        } }
      } catch { if (req === request) results.innerHTML = '<div class="list-empty"><span data-icon="wifi-off"></span><h3>Search couldn’t load</h3><p>Check your connection and try again.</p></div>'; }
    };
    tabs.forEach(tab => tab.onclick = () => { type = tab.dataset.searchType; search(); });
    input.oninput = Utils.debounce(() => search(),200);
    document.getElementById('search-sender').oninput = Utils.debounce(() => search(),250);
    ['search-has','search-after','search-before'].forEach(id => document.getElementById(id).onchange = () => search());
    document.getElementById('btn-clear-message-search').onclick = () => { input.value = ''; search(); input.focus(); };
    search();
  };

  const renderSharedContent = () => {
    const list = document.getElementById('shared-content-list'); if (!list) return;
    const attachments = messages.filter(m => !m.is_deleted).flatMap(m => m.attachments || []);
    const media = attachments.filter(a => a.file_type.startsWith('image/'));
    const files = attachments.filter(a => !a.file_type.startsWith('image/'));
    const links = [...new Set(messages.filter(m => !m.is_deleted).flatMap(m => (m.content || '').match(/https?:\/\/[^\s<>]+/gi) || []).map(url => url.replace(/[.,!?;:)]+$/, '')))];
    const sets = {media,files,links};
    document.querySelectorAll('[data-shared-tab]').forEach(tab => {
      tab.classList.toggle('active',tab.dataset.sharedTab === selectedSharedTab);
      tab.setAttribute('aria-pressed',String(tab.dataset.sharedTab === selectedSharedTab));
      tab.querySelector('span').textContent = sets[tab.dataset.sharedTab].length;
      tab.onclick = () => { selectedSharedTab = tab.dataset.sharedTab; renderSharedContent(); };
    });
    list.className = selectedSharedTab === 'media' ? 'shared-media-grid' : 'shared-content-list'; list.innerHTML = '';
    const content = sets[selectedSharedTab];
    if (!content.length) { list.innerHTML = `<p class="shared-empty">No ${selectedSharedTab} in loaded history yet.</p>`; return; }
    content.forEach(item => {
      const url = selectedSharedTab === 'links' ? item : API.resolveUrl(item.file_url);
      const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (selectedSharedTab === 'media') {
        const img = document.createElement('img'); img.src = url; img.alt = item.file_name; img.loading = 'lazy'; link.append(img);
        link.onclick = e => { e.preventDefault(); document.getElementById('attachment-preview-image').src = url; document.getElementById('attachment-preview-image').alt = item.file_name; document.getElementById('attachment-preview-download').href = url; document.getElementById('attachment-preview-title').textContent = item.file_name; Utils.openModal('modal-attachment-preview'); };
      } else {
        link.innerHTML = AppUI.icon(selectedSharedTab === 'links' ? 'link' : 'file');
        const label = document.createElement('span'); label.textContent = selectedSharedTab === 'links' ? item : item.file_name;
        link.append(label); if (selectedSharedTab === 'files') { const size = document.createElement('small'); size.textContent = Utils.formatFileSize(item.file_size); link.append(size); }
      }
      list.append(link);
    });
  };
  const setupChatInfoModal = () => {
    if (!activeConversation) return;
    const conv = activeConversation; const isGroup = conv.type === 'GROUP'; const admin = isGroupAdmin(conv);
    Utils.openModal('modal-group-info');
    document.getElementById('btn-details').setAttribute('aria-expanded','true');
    document.getElementById('group-info-avatar').src = chatAvatar(conv);
    document.getElementById('group-info-avatar').alt = chatName(conv);
    document.getElementById('group-info-name').textContent = chatName(conv);
    document.getElementById('group-info-handle').textContent = isGroup ? `${conv.members.length} members · Group conversation` : `@${conv.other_user?.username || ''}`;
    document.getElementById('group-info-desc').textContent = conv.description || conv.other_user?.bio || (isGroup ? 'A place to keep everyone in the loop.' : 'A little closer, one conversation at a time.');
    document.getElementById('group-members-section').classList.toggle('hidden',!isGroup);
    document.getElementById('btn-leave-group').classList.toggle('hidden',!isGroup);
    document.getElementById('btn-block-contact').classList.toggle('hidden',isGroup);
    document.getElementById('btn-edit-group').classList.toggle('hidden',!admin);
    document.getElementById('btn-add-group-member').classList.toggle('hidden',!admin);
    document.getElementById('btn-edit-group').onclick = () => setupEditGroup(conv);
    document.getElementById('btn-add-group-member').onclick = () => setupAddMember(conv);
    const favorite = document.getElementById('btn-detail-favorite'); const mute = document.getElementById('btn-detail-mute');
    favorite.innerHTML = `${AppUI.icon('star')}<span>${pref(conv.id).favorite ? 'Favorited' : 'Favorite'}</span>`;
    mute.innerHTML = `${AppUI.icon(pref(conv.id).muted ? 'bell-off' : 'bell')}<span>${pref(conv.id).muted ? 'Muted' : 'Notifications'}</span>`;
    favorite.setAttribute('aria-pressed',String(!!pref(conv.id).favorite)); mute.setAttribute('aria-pressed',String(!!pref(conv.id).muted));
    favorite.onclick = () => { updatePreference(conv.id,'favorite'); setupChatInfoModal(); };
    mute.onclick = () => { updatePreference(conv.id,'muted'); setupChatInfoModal(); };
    renderSharedContent();
    const members = document.getElementById('group-members-list'); members.innerHTML = '';
    if (isGroup) conv.members.forEach(member => {
      const u = member.user; const item = document.createElement('div'); item.className = 'member-item';
      item.innerHTML = `<img class="user-avatar-sm" src="${Utils.escapeHTML(AppUI.avatarUrl(u?.avatar_url,u?.display_name || u?.username))}" alt="" /><div class="member-info"><span class="member-name">${Utils.escapeHTML(u?.display_name || u?.username || 'Member')}${member.user_id === currentUser.id ? ' (you)' : ''}</span><span class="member-role ${member.role === 'ADMIN' ? 'admin-badge' : ''}">${member.role === 'ADMIN' ? 'Admin' : 'Member'}</span></div>${admin && member.user_id !== currentUser.id ? '<button class="icon-btn btn-remove-member" title="Remove member" aria-label="Remove member">'+AppUI.icon('x')+'</button>' : ''}`;
      item.querySelector('.btn-remove-member')?.setAttribute('aria-label',`Remove ${u?.display_name || u?.username || 'member'}`);
      item.querySelector('.btn-remove-member')?.addEventListener('click',async () => {
        if (!await AppUI.confirm({title:'Remove this member?',description:`${u?.display_name || u?.username} will no longer have access to this group.`,action:'Remove member'})) return;
        try { await Groups.removeMember(conv.id,member.user_id); await loadConversations(); Utils.showToast('Member removed', 'success'); }
        catch { Utils.showToast('This member couldn’t be removed. Please try again.', 'error'); }
      });
      members.append(item);
    });
    document.getElementById('btn-leave-group').onclick = async () => {
      if (!await AppUI.confirm({title:'Leave this group?',description:'You’ll need to be added again to rejoin the conversation.',action:'Leave group'})) return;
      try { await Groups.leave(conv.id); closeConversation(); await loadConversations(); Utils.showToast('You left the group', 'info'); }
      catch { Utils.showToast('The group couldn’t be left. Please try again.', 'error'); }
    };
    document.getElementById('btn-block-contact').onclick = async () => {
      if (!await AppUI.confirm({title:`Block ${chatName(conv)}?`,description:'You won’t be able to exchange direct messages. You can unblock this person in Privacy settings.',action:'Block contact'})) return;
      try { await Users.blockUser(conv.other_user.id); Utils.closeModal('modal-group-info'); }
      catch { Utils.showToast('This contact couldn’t be blocked. Please try again.', 'error'); }
    };
  };
  const setupEditGroup = conv => {
    document.getElementById('edit-group-name').value = conv.name;
    document.getElementById('edit-group-description').value = conv.description || '';
    Utils.openModal('modal-edit-group');
    document.getElementById('edit-group-form').onsubmit = async e => {
      e.preventDefault(); const button = document.getElementById('btn-save-group'); button.disabled = true;
      try { await Groups.update(conv.id,document.getElementById('edit-group-name').value.trim(),document.getElementById('edit-group-description').value.trim(),conv.avatar_url); Utils.closeModal('modal-edit-group'); await loadConversations(); Utils.showToast('Group updated', 'success'); }
      catch { Utils.showToast('The group couldn’t be updated. Please try again.', 'error'); }
      finally { button.disabled = false; }
    };
  };
  const setupAddMember = conv => {
    Utils.openModal('modal-add-member'); const input = document.getElementById('add-member-search'); const results = document.getElementById('add-member-results');
    input.value = ''; results.innerHTML = '<p class="empty-list-notice">Find a person by name or username.</p>';
    input.oninput = Utils.debounce(async () => {
      const q = input.value.trim(); if (!q) { results.innerHTML = ''; return; }
      try {
        const users = await Users.search(q); if (input.value.trim() !== q) return;
        results.innerHTML = ''; const existing = new Set(conv.members.map(m => m.user_id));
        users.filter(u => !existing.has(u.id)).forEach(u => {
          const item = Users.renderUserItem(u,async selected => {
            try { await Groups.addMember(conv.id,selected.id); Utils.closeModal('modal-add-member'); await loadConversations(); Utils.showToast('Member added', 'success'); }
            catch { Utils.showToast('This person couldn’t be added. Please try again.', 'error'); }
          }); item.querySelector('.action-btn').textContent = 'Add'; results.append(item);
        });
        if (!results.childElementCount) results.innerHTML = '<p class="empty-list-notice">No new people found.</p>';
      } catch { results.innerHTML = '<p class="empty-list-notice">People couldn’t load. Please try again.</p>'; }
    },250);
  };
  const loadBlockedUsers = async () => {
    const list = document.getElementById('blocked-users-list');
    list.innerHTML = '<div class="skeleton-row"></div>';
    try {
      const users = await Users.getBlockedUsers(); list.innerHTML = '';
      if (!users.length) list.innerHTML = '<p class="shared-empty">No blocked contacts.</p>';
      users.forEach(user => {
        const item = document.createElement('div'); item.className = 'member-item';
        item.innerHTML = `<span class="member-info">${Utils.escapeHTML(user.display_name || user.username)}</span><button class="btn btn-secondary btn-sm">Unblock</button>`;
        item.querySelector('button').onclick = async () => { try { await Users.unblockUser(user.id); loadBlockedUsers(); } catch { Utils.showToast('This contact couldn’t be unblocked.', 'error'); } }; list.append(item);
      });
    } catch { list.innerHTML = '<p class="shared-empty">Blocked contacts couldn’t load.</p>'; }
  };

  // --- Modal: Settings ---
  const setupSettingsModal = () => {
    Utils.openModal('modal-settings');

    // Populate Settings Tabs
    const tabs = Utils.$$('.settings-tab-btn');
    const panes = Utils.$$('.settings-pane');

    tabs.forEach(tab => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const target = Utils.$(`#pane-${tab.dataset.tab}`);
        if (target) target.classList.add('active');
        if (tab.dataset.tab === 'privacy') loadBlockedUsers();
        if (tab.dataset.tab === 'security') { loadSessions(); load2FA(); loadPasskeys(); }
      };
    });

    currentUser = Auth.getCurrentUser() || currentUser;
    Utils.$('#settings-cur-password').closest('.form-group').classList.toggle('hidden',currentUser.has_password === false);
    Utils.$('#settings-avatar-preview').src = AppUI.avatarUrl(currentUser.avatar_url,currentUser.display_name || currentUser.username);
    // Populate inputs with current settings
    Utils.$('#settings-display-name').value = currentUser.display_name || '';
    Utils.$('#settings-bio').value = currentUser.bio || '';
    Utils.$('#settings-show-last-seen').checked = currentUser.show_last_seen !== false;
    Utils.$('#settings-show-online').checked = currentUser.show_online !== false;
    Utils.$('#settings-show-read').checked = currentUser.show_read_receipts !== false;

    const notifSettings = Notifications.getSettings();
    Utils.$('#settings-sound-enabled').checked = notifSettings.soundEnabled !== false;
    Utils.$('#settings-desktop-enabled').checked = notifSettings.desktopEnabled !== false;

    // Save Profile
    Utils.$('#btn-save-profile').onclick = async () => {
      const button = Utils.$('#btn-save-profile'); button.disabled = true; button.textContent = 'Saving…';
      try {
        const dName = Utils.$('#settings-display-name').value.trim();
        const bio = Utils.$('#settings-bio').value.trim();
        currentUser = await ProfileManager.updateProfile(dName, bio);
        initUserHeader();
      } catch (e) {}
      finally { button.disabled = false; button.textContent = 'Save Profile'; }
    };

    // Save Privacy
    Utils.$('#btn-save-privacy').onclick = async () => {
      const button = Utils.$('#btn-save-privacy'); button.disabled = true; button.textContent = 'Saving…';
      try {
        const lastSeen = Utils.$('#settings-show-last-seen').checked;
        const online = Utils.$('#settings-show-online').checked;
        const read = Utils.$('#settings-show-read').checked;
        currentUser = await ProfileManager.updatePrivacy(lastSeen, online, read);
      } catch (e) {}
      finally { button.disabled = false; button.textContent = 'Save Privacy'; }
    };

    // Save Notifications
    Utils.$('#btn-save-notifications').onclick = async () => {
      const sound = Utils.$('#settings-sound-enabled').checked;
      const desktop = Utils.$('#settings-desktop-enabled').checked;
      const enabled = desktop ? await Notifications.requestPermission() : false;
      Utils.$('#settings-desktop-enabled').checked = enabled;
      Notifications.saveSettings({ soundEnabled: sound, desktopEnabled: enabled });
      if (desktop && !enabled) Utils.showToast('Desktop notifications are blocked or unavailable in this browser.', 'warning');
      Utils.showToast('Notification preferences saved!', 'success');
    };

    // --- Security Settings: Sessions, 2FA, Passkeys, Password ---

    // 1. Load and Render Active Sessions
    const loadSessions = async () => {
      const container = Utils.$('#sessions-list-container');
      if (!container) return;
      try {
        const sessions = await Auth.fetchSessions();
        if (!sessions || sessions.length === 0) {
          container.innerHTML = '<div style="font-size: 0.8125rem; color: var(--text-muted); text-align: center; padding: 0.5rem;">No active sessions found.</div>';
          return;
        }

        container.innerHTML = '';
        sessions.forEach(s => {
          const item = document.createElement('div');
          item.className = 'session-item';
          const isPhone = s.device_name && (s.device_name.includes('iPhone') || s.device_name.includes('Android') || s.device_name.includes('iPad'));
          const icon = AppUI.icon(isPhone ? 'smartphone' : 'monitor');
          const lastActiveStr = Utils.formatLastSeen(false, s.last_active);

          item.innerHTML = `
            <div class="session-info">
              <span class="session-icon">${icon}</span>
              <div>
                <div class="session-device-name">
                  ${Utils.escapeHTML(s.device_name || 'Device')}
                  ${s.is_current ? '<span class="session-current-tag">This device</span>' : ''}
                </div>
                <div class="session-meta">
                  ${Utils.escapeHTML(s.ip_address || 'Unknown IP')} • ${lastActiveStr}
                </div>
              </div>
            </div>
            <div>
              ${s.is_current 
                ? '<span style="font-size: 0.75rem; color: #16a34a; font-weight: 500;">Active</span>' 
                : `<button class="btn btn-sm btn-secondary btn-terminate-session" data-id="${s.session_id}" style="color: #ef4444; font-size: 0.75rem;">Logout</button>`
              }
            </div>
          `;
          container.appendChild(item);
        });

        // Bind individual session logout
        container.querySelectorAll('.btn-terminate-session').forEach(btn => {
          btn.onclick = async () => {
            const sid = btn.dataset.id;
            try {
              await Auth.revokeSession(sid);
              Utils.showToast('Device session logged out', 'info');
              loadSessions();
            } catch (err) {
              Utils.showToast(err.message, 'error');
            }
          };
        });
      } catch (err) {
        container.innerHTML = `<div style="font-size: 0.8125rem; color: #ef4444; text-align: center;">Failed to load sessions: ${Utils.escapeHTML(err.message)}</div>`;
      }
    };

    // Terminate all other sessions
    const btnTerminateOthers = Utils.$('#btn-terminate-other-sessions');
    if (btnTerminateOthers) {
      btnTerminateOthers.onclick = async () => {
        if (!await AppUI.confirm({title:'Log out other devices?',description:'This device will stay signed in. Other devices will need to sign in again.',action:'Log out devices'})) return;
        try {
          const res = await Auth.revokeOtherSessions();
          Utils.showToast(res.message, 'success');
          loadSessions();
        } catch (err) {
          Utils.showToast(err.message, 'error');
        }
      };
    }

    // 2. 2FA Status & Controls
    let cachedRecoveryCodes = [];
    const load2FA = async () => {
      try {
        const user = await Auth.fetchMyProfile();
        const badge = Utils.$('#twofa-status-badge');
        const btnOpenSetup = Utils.$('#btn-open-2fa-setup');
        const btnDisable = Utils.$('#btn-disable-2fa');

        if (user.totp_enabled === undefined) {
          badge.textContent = 'Status unavailable'; badge.className = 'security-badge';
          btnOpenSetup.textContent = 'Set up 2FA'; btnDisable.classList.remove('hidden');
        } else if (user.totp_enabled) {
          badge.textContent = 'Active';
          badge.className = 'security-badge active';
          btnOpenSetup.textContent = 'Reconfigure 2FA';
          btnDisable.classList.remove('hidden');
        } else {
          badge.textContent = 'Disabled';
          badge.className = 'security-badge inactive';
          btnOpenSetup.textContent = 'Enable 2FA';
          btnDisable.classList.add('hidden');
        }
      } catch (e) {}
    };

    // Open 2FA Setup
    const btnOpen2FA = Utils.$('#btn-open-2fa-setup');
    if (btnOpen2FA) {
      btnOpen2FA.onclick = async () => {
        try {
          const res = await Auth.setup2FA();
          Utils.$('#setup-2fa-qr').src = res.qr_code;
          Utils.$('#setup-2fa-secret').textContent = res.secret;
          Utils.$('#setup-2fa-code').value = '';
          Utils.$('#setup-2fa-step-1').classList.remove('hidden');
          Utils.$('#setup-2fa-step-2').classList.add('hidden');
          Utils.openModal('modal-2fa-setup');
        } catch (err) {
          Utils.showToast(err.message, 'error');
        }
      };
    }

    // Confirm & Enable 2FA
    const btnConfirm2FA = Utils.$('#btn-confirm-enable-2fa');
    if (btnConfirm2FA) {
      btnConfirm2FA.onclick = async () => {
        const code = Utils.$('#setup-2fa-code').value.trim();
        if (!code) {
          Utils.showToast('Please enter the 6-digit code', 'warning');
          return;
        }
        btnConfirm2FA.disabled = true;
        btnConfirm2FA.textContent = 'Verifying...';
        try {
          const res = await Auth.enable2FA(code);
          cachedRecoveryCodes = res.recovery_codes || [];
          
          // Render recovery codes in grid
          const grid = Utils.$('#setup-recovery-codes-grid');
          grid.innerHTML = '';
          cachedRecoveryCodes.forEach(rc => {
            const badge = document.createElement('div');
            badge.className = 'recovery-code-badge';
            badge.textContent = rc;
            grid.appendChild(badge);
          });

          Utils.$('#setup-2fa-step-1').classList.add('hidden');
          Utils.$('#setup-2fa-step-2').classList.remove('hidden');
          Auth.setCurrentUser({...Auth.getCurrentUser(),totp_enabled:true});
          load2FA();
          Utils.showToast('Two-factor authentication enabled!', 'success');
        } catch (err) {
          Utils.showToast(err.message, 'error');
        } finally {
          btnConfirm2FA.disabled = false;
          btnConfirm2FA.textContent = 'Verify & Activate 2FA';
        }
      };
    }

    // Copy recovery codes
    const btnCopyCodes = Utils.$('#btn-copy-recovery-codes');
    if (btnCopyCodes) {
      btnCopyCodes.onclick = () => {
        if (cachedRecoveryCodes.length > 0) {
          navigator.clipboard.writeText(cachedRecoveryCodes.join('\n'));
          Utils.showToast('Recovery codes copied to clipboard!', 'info');
        }
      };
    }

    const btnFinish2FA = Utils.$('#btn-finish-2fa');
    if (btnFinish2FA) {
      btnFinish2FA.onclick = () => {
        Utils.closeModal('modal-2fa-setup');
      };
    }

    // Disable 2FA
    const btnDisable2FA = Utils.$('#btn-disable-2fa');
    if (btnDisable2FA) {
      btnDisable2FA.onclick = async () => {
        const code = await AppUI.requestInput({title:'Disable two-factor authentication?',description:'Verify your identity with an authenticator code or account password.',label:'Authenticator code or password',type:'password',action:'Disable 2FA'});
        if (!code) return;
        try {
          await Auth.disable2FA(code.length === 6 && !isNaN(code) ? code : null, code);
          Auth.setCurrentUser({...Auth.getCurrentUser(),totp_enabled:false});
          Utils.showToast('Two-factor authentication disabled', 'info');
          load2FA();
        } catch (err) {
          Utils.showToast(err.message, 'error');
        }
      };
    }

    // 3. Passkeys Management
    const loadPasskeys = async () => {
      const container = Utils.$('#passkeys-list-container');
      if (!container) return;
      try {
        const keys = await Auth.listPasskeys();
        if (!keys || keys.length === 0) {
          container.innerHTML = '<div style="font-size: 0.8125rem; color: var(--text-muted); text-align: center; padding: 0.5rem;">No passkeys registered yet.</div>';
          return;
        }

        container.innerHTML = '';
        keys.forEach(k => {
          const item = document.createElement('div');
          item.className = 'session-item';
          item.innerHTML = `
            <div class="session-info">
              <span class="session-icon">${AppUI.icon('key')}</span>
              <div>
                <div class="session-device-name">${Utils.escapeHTML(k.name || 'Passkey')}</div>
                <div class="session-meta">Created ${Utils.formatLastSeen(false, k.created_at)}</div>
              </div>
            </div>
            <button class="btn btn-sm btn-secondary btn-del-passkey" data-id="${k.id}" style="color: #ef4444; font-size: 0.75rem;">Remove</button>
          `;
          container.appendChild(item);
        });

        container.querySelectorAll('.btn-del-passkey').forEach(btn => {
          btn.onclick = async () => {
            if (!await AppUI.confirm({title:'Remove this passkey?',description:'This key will no longer be available to sign in to your account.',action:'Remove passkey'})) return;
            try {
              await Auth.deletePasskey(btn.dataset.id);
              Utils.showToast('Passkey removed', 'info');
              loadPasskeys();
            } catch (err) {
              Utils.showToast(err.message, 'error');
            }
          };
        });
      } catch (err) {
        container.innerHTML = `<div style="font-size: 0.8125rem; color: #ef4444; text-align: center;">Failed to load passkeys: ${Utils.escapeHTML(err.message)}</div>`;
      }
    };

    // Open add passkey modal
    const btnOpenAddPasskey = Utils.$('#btn-open-add-passkey');
    if (btnOpenAddPasskey) {
      btnOpenAddPasskey.onclick = () => {
        Utils.$('#input-passkey-name').value = '';
        Utils.openModal('modal-add-passkey');
      };
    }

    const btnCreatePasskeySubmit = Utils.$('#btn-create-passkey-submit');
    if (btnCreatePasskeySubmit) {
      btnCreatePasskeySubmit.onclick = async () => {
        const name = Utils.$('#input-passkey-name').value.trim() || 'My Device Passkey';
        btnCreatePasskeySubmit.disabled = true;
        btnCreatePasskeySubmit.textContent = 'Awaiting Biometrics...';
        try {
          await Auth.registerPasskey(name);
          Utils.showToast('Passkey registered successfully!', 'success');
          Utils.closeModal('modal-add-passkey');
          loadPasskeys();
        } catch (err) {
          Utils.showToast(err.message, 'error');
        } finally {
          btnCreatePasskeySubmit.disabled = false;
          btnCreatePasskeySubmit.textContent = 'Continue with Biometrics / Key';
        }
      };
    }

    if (document.querySelector('.settings-tab-btn.active')?.dataset.tab === 'privacy') loadBlockedUsers();
    if (document.querySelector('.settings-tab-btn.active')?.dataset.tab === 'security') { loadSessions(); load2FA(); loadPasskeys(); }

    // 4. Change Password
    Utils.$('#btn-save-password').onclick = async () => {
      const curPwd = Utils.$('#settings-cur-password').value;
      const newPwd = Utils.$('#settings-new-password').value;
      const confPwd = Utils.$('#settings-conf-password').value;
      try {
        await Auth.changePassword(curPwd, newPwd, confPwd);
        Utils.showToast('Password changed successfully!', 'success');
        Utils.$('#settings-cur-password').value = '';
        Utils.$('#settings-new-password').value = '';
        Utils.$('#settings-conf-password').value = '';
      } catch (e) {
        Utils.showToast(e.message, 'error');
      }
    };

    // Avatar upload in settings
    const avatarInput = Utils.$('#settings-avatar-input');
    if (avatarInput) {
      avatarInput.onchange = async (e) => {
        if (e.target.files && e.target.files[0]) {
          try {
            const url = await ProfileManager.uploadAvatar(e.target.files[0]);
            await ProfileManager.updateProfile(currentUser.display_name, currentUser.bio, url);
            currentUser.avatar_url = url;
            initUserHeader();
            Utils.$('#settings-avatar-preview').src = API.resolveUrl(url);
          } catch (err) {}
        }
      };
    }
  };

  document.getElementById('btn-history-latest').onclick = () => { document.getElementById('history-context').classList.add('hidden'); if (activeConversation) loadMessageHistory(activeConversation); };
  elements.modalGroupInfo.addEventListener('dialogclose', () => document.getElementById('btn-details').setAttribute('aria-expanded','false'));
  // Initialize Application
  initUserHeader();
  initWebSocket();
  Calls.init();
  Stories.init();
  bindUIEvents();
  document.getElementById('btn-mobile-stories').onclick = () => document.getElementById('nav-stories').click();
  document.getElementById('btn-mobile-group').onclick = () => document.getElementById('btn-new-group').click();
  loadConversations();
  if (outbox.size) Utils.showToast('Your unsent messages are saved. Open their conversations to retry.', 'info');
  const settingsTab = new URLSearchParams(location.search).get('settings');
  if (settingsTab) { setupSettingsModal(); document.querySelector(`[data-tab="${CSS.escape(settingsTab)}"]`)?.click(); }
});
