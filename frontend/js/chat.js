// Real-Time Chat Application Engine
document.addEventListener('DOMContentLoaded', () => {
  // Enforce authentication
  if (!Auth.requireAuth()) return;

  const currentUser = Auth.getCurrentUser();
  let conversations = [];
  let activeConversation = null;
  let messages = [];
  let replyingToMessage = null;
  let editingMessage = null;
  let pendingAttachments = [];
  let typingTimer = null;
  let isTyping = false;

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
      elements.myAvatar.src = API.resolveUrl(currentUser.avatar_url) || `https://api.dicebear.com/7.x/initials/svg?seed=${currentUser.username}`;
    }
    if (elements.myName) {
      elements.myName.textContent = currentUser.display_name || currentUser.username;
    }
  };

  // Connect WebSocket
  const initWebSocket = () => {
    WSClient.connect();

    WSClient.on('connection_open', () => {
      if (elements.myStatusDot) elements.myStatusDot.className = 'online-dot online';
    });

    WSClient.on('connection_close', () => {
      if (elements.myStatusDot) elements.myStatusDot.className = 'online-dot offline';
    });

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
  };

  // Load user's conversations
  const loadConversations = async () => {
    try {
      conversations = await API.get('/conversations');
      renderConversationsList();
    } catch (err) {
      Utils.showToast('Failed to load conversations: ' + err.message, 'error');
    }
  };

  // Render conversations sidebar
  const renderConversationsList = (filterText = '') => {
    if (!elements.conversationsList) return;
    elements.conversationsList.innerHTML = '';

    const filtered = conversations.filter(c => {
      const name = c.name || (c.other_user && (c.other_user.display_name || c.other_user.username)) || 'Chat';
      return name.toLowerCase().includes(filterText.toLowerCase());
    });

    if (filtered.length === 0) {
      elements.conversationsList.innerHTML = `
        <div class="empty-list-notice">
          ${filterText ? 'No matching conversations' : 'No chats yet. Start a new conversation!'}
        </div>
      `;
      return;
    }

    filtered.forEach(conv => {
      const item = document.createElement('div');
      item.className = `conversation-item ${activeConversation && activeConversation.id === conv.id ? 'active' : ''}`;
      item.dataset.id = conv.id;

      const isGroup = conv.type === 'GROUP';
      const name = conv.name || (conv.other_user && (conv.other_user.display_name || conv.other_user.username)) || 'Conversation';
      const avatar = API.resolveUrl(conv.avatar_url) || `https://api.dicebear.com/7.x/initials/svg?seed=${name}`;
      const isOnline = !isGroup && conv.other_user && conv.other_user.is_online;

      const lastMsgText = conv.last_message 
        ? (conv.last_message.is_deleted ? '🚫 Deleted message' : (conv.last_message.content || 'Attachment'))
        : 'Start chatting';
      const lastMsgTime = conv.last_message ? Utils.formatMessageTime(conv.last_message.created_at) : '';

      item.innerHTML = `
        <div class="conv-avatar-wrap">
          <img src="${avatar}" alt="${Utils.escapeHTML(name)}" class="conv-avatar" />
          ${!isGroup ? `<span class="online-dot ${isOnline ? 'online' : 'offline'}" id="status-dot-${conv.other_user ? conv.other_user.id : ''}"></span>` : '<span class="group-badge">👥</span>'}
        </div>
        <div class="conv-details">
          <div class="conv-header">
            <span class="conv-name">${Utils.escapeHTML(name)}</span>
            <span class="conv-time">${lastMsgTime}</span>
          </div>
          <div class="conv-footer">
            <span class="conv-snippet">${Utils.escapeHTML(lastMsgText)}</span>
            ${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
          </div>
        </div>
      `;

      item.addEventListener('click', () => selectConversation(conv));
      elements.conversationsList.appendChild(item);
    });
  };

  // Select and open a conversation
  const selectConversation = async (conv) => {
    activeConversation = conv;
    replyingToMessage = null;
    editingMessage = null;
    hideReplyPreview();
    hideEditPreview();

    // Mobile UI sidebar toggle
    document.body.classList.add('mobile-chat-open');

    // Update active highlight in sidebar
    Utils.$$('.conversation-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.id) === conv.id);
    });

    // Update header
    const isGroup = conv.type === 'GROUP';
    const name = conv.name || (conv.other_user && (conv.other_user.display_name || conv.other_user.username)) || 'Chat';
    const avatar = API.resolveUrl(conv.avatar_url) || `https://api.dicebear.com/7.x/initials/svg?seed=${name}`;

    elements.emptyChatState.classList.add('hidden');
    elements.activeChatWindow.classList.remove('hidden');

    elements.chatAvatar.src = avatar;
    elements.chatTitle.textContent = name;

    if (isGroup) {
      elements.chatSubtitle.textContent = `${conv.members.length} members`;
      elements.chatHeaderStatus.className = 'status-text';
    } else {
      const isOnline = conv.other_user && conv.other_user.is_online;
      const lastSeenText = conv.other_user ? Utils.formatLastSeen(isOnline, conv.other_user.last_seen) : 'Offline';
      elements.chatSubtitle.textContent = lastSeenText;
      elements.chatHeaderStatus.className = `status-text ${isOnline ? 'online-text' : ''}`;
    }

    // Reset unread counter on this conversation
    conv.unread_count = 0;
    renderConversationsList(elements.convSearchInput ? elements.convSearchInput.value : '');

    // Fetch message history
    try {
      messages = await API.get(`/messages/conversation/${conv.id}`);
      renderMessages();
      scrollToBottom();
      // Send read receipt
      WSClient.sendRead(conv.id);
    } catch (err) {
      Utils.showToast('Failed to load messages: ' + err.message, 'error');
    }
  };

  // Render message history
  const renderMessages = () => {
    if (!elements.messagesList) return;
    elements.messagesList.innerHTML = '';

    let lastDateStr = null;

    messages.forEach(msg => {
      const msgDateStr = Utils.formatDateHeader(msg.created_at);
      if (msgDateStr !== lastDateStr) {
        const dateHeader = document.createElement('div');
        dateHeader.className = 'message-date-separator';
        dateHeader.innerHTML = `<span>${msgDateStr}</span>`;
        elements.messagesList.appendChild(dateHeader);
        lastDateStr = msgDateStr;
      }

      const bubble = createMessageElement(msg);
      elements.messagesList.appendChild(bubble);
    });
  };

  // Create single message DOM element
  const createMessageElement = (msg) => {
    const isOwn = msg.sender_id === currentUser.id;
    const isDeleted = msg.is_deleted;
    const bubble = document.createElement('div');
    bubble.className = `message-row ${isOwn ? 'message-own' : 'message-other'}`;
    bubble.id = `msg-${msg.id}`;

    const senderName = msg.sender ? (msg.sender.display_name || msg.sender.username) : 'User';
    const avatar = API.resolveUrl(msg.sender ? msg.sender.avatar_url : null) || `https://api.dicebear.com/7.x/initials/svg?seed=${senderName}`;
    const timeStr = Utils.formatMessageTime(msg.created_at);

    // Group message sender avatar
    const showAvatar = !isOwn && activeConversation && activeConversation.type === 'GROUP';

    // Reply preview
    let replyHtml = '';
    if (msg.reply_to) {
      replyHtml = `
        <div class="message-reply-quote" onclick="document.getElementById('msg-${msg.reply_to.id}')?.scrollIntoView({ behavior: 'smooth', block: 'center' })">
          <div class="reply-sender">${Utils.escapeHTML(msg.reply_to.sender_name || 'User')}</div>
          <div class="reply-text">${Utils.escapeHTML(msg.reply_to.content)}</div>
        </div>
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
            <a href="${fileUrl}" target="_blank" rel="noopener noreferrer" class="attachment-image-link">
              <img src="${fileUrl}" alt="${Utils.escapeHTML(att.file_name)}" class="attachment-image" loading="lazy" />
            </a>
          `;
        } else {
          attachmentsHtml += `
            <a href="${fileUrl}" target="_blank" download="${Utils.escapeHTML(att.file_name)}" class="attachment-file-card">
              <span class="file-icon">📄</span>
              <div class="file-info">
                <span class="file-name">${Utils.escapeHTML(att.file_name)}</span>
                <span class="file-size">${Utils.formatFileSize(att.file_size)}</span>
              </div>
              <span class="download-icon">⬇</span>
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
          <button class="reaction-chip ${hasReacted ? 'active' : ''}" data-emoji="${emoji}">
            <span>${emoji}</span> <span class="rxn-count">${counts[emoji]}</span>
          </button>
        `;
      });
      reactionsHtml += '</div>';
    }

    // Status receipt ticks (for own messages)
    const receiptHtml = isOwn ? Utils.renderReceiptTicks(msg.status) : '';

    bubble.innerHTML = `
      ${showAvatar ? `<img src="${avatar}" alt="${Utils.escapeHTML(senderName)}" class="message-sender-avatar" title="${Utils.escapeHTML(senderName)}" />` : ''}
      <div class="message-bubble ${isDeleted ? 'deleted-bubble' : ''}">
        ${showAvatar ? `<div class="message-sender-name">${Utils.escapeHTML(senderName)}</div>` : ''}
        ${replyHtml}
        ${attachmentsHtml}
        <div class="message-text">
          ${isDeleted ? '<i>🚫 This message was deleted</i>' : Utils.escapeHTML(msg.content)}
        </div>
        <div class="message-meta">
          ${msg.is_edited && !isDeleted ? '<span class="edited-label">(edited)</span>' : ''}
          <span class="message-time">${timeStr}</span>
          ${receiptHtml}
        </div>
        ${reactionsHtml}

        ${!isDeleted ? `
          <div class="message-actions-hover">
            <button class="action-icon-btn btn-quick-react" title="React">😀</button>
            <button class="action-icon-btn btn-reply" title="Reply">↩</button>
            ${isOwn ? '<button class="action-icon-btn btn-edit" title="Edit">✏️</button>' : ''}
            ${isOwn || (activeConversation && activeConversation.type === 'GROUP' && isGroupAdmin(activeConversation)) ? '<button class="action-icon-btn btn-delete" title="Delete">🗑️</button>' : ''}
          </div>
        ` : ''}
      </div>
    `;

    // Event handlers on message actions
    if (!isDeleted) {
      const btnReact = bubble.querySelector('.btn-quick-react');
      if (btnReact) {
        btnReact.addEventListener('click', (e) => {
          e.stopPropagation();
          showReactionMenu(msg.id, e.target);
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
    replyingToMessage = msg;
    hideEditPreview();
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
    editingMessage = msg;
    hideReplyPreview();
    elements.editContent.textContent = msg.content;
    elements.editPreviewBar.classList.remove('hidden');
    elements.messageInput.value = msg.content;
    elements.messageInput.focus();
  };

  const hideEditPreview = () => {
    editingMessage = null;
    elements.editPreviewBar.classList.add('hidden');
    elements.messageInput.value = '';
  };

  // Delete message
  const confirmDeleteMessage = async (msgId) => {
    if (!confirm('Are you sure you want to delete this message?')) return;
    try {
      await API.delete(`/messages/${msgId}`);
      Utils.showToast('Message deleted', 'info');
    } catch (err) {
      Utils.showToast(err.message, 'error');
    }
  };

  // Toggle reaction
  const toggleReaction = async (msgId, emoji) => {
    try {
      await API.post(`/messages/${msgId}/reaction`, { emoji });
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
    popup.style.top = `${rect.top - 46}px`;
    popup.style.left = `${rect.left - 30}px`;

    // Close on click outside
    const closeListener = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', closeListener);
      }
    };
    setTimeout(() => document.addEventListener('click', closeListener), 50);
  };

  // Send message action
  const sendMessage = async () => {
    if (!activeConversation) return;

    const content = elements.messageInput.value.trim();
    if (!content && pendingAttachments.length === 0) return;

    // If editing existing message
    if (editingMessage) {
      try {
        await API.put(`/messages/${editingMessage.id}`, { content });
        hideEditPreview();
      } catch (err) {
        Utils.showToast(err.message, 'error');
      }
      return;
    }

    const payload = {
      conversation_id: activeConversation.id,
      content: content || 'Attachment',
      message_type: pendingAttachments.length > 0 ? (pendingAttachments[0].file_type.startsWith('image/') ? 'IMAGE' : 'FILE') : 'TEXT',
      reply_to_id: replyingToMessage ? replyingToMessage.id : null,
      attachments: pendingAttachments.map(a => ({
        file_url: a.file_url,
        file_name: a.file_name,
        file_type: a.file_type,
        file_size: a.file_size,
        public_id: a.public_id
      }))
    };

    // Clear inputs immediately for responsiveness
    elements.messageInput.value = '';
    elements.messageInput.style.height = 'auto';
    pendingAttachments = [];
    renderAttachmentPreviews();
    hideReplyPreview();
    stopTyping();

    // Send via WebSocket or fallback REST API
    const sentViaWs = WSClient.send(CONFIG.EVENTS.MESSAGE, payload);
    if (!sentViaWs) {
      try {
        await API.post('/messages', payload);
      } catch (err) {
        Utils.showToast('Failed to send message: ' + err.message, 'error');
      }
    }
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

  // Real-time Event Handlers
  const handleIncomingMessage = (msg) => {
    // If message is in currently active conversation
    if (activeConversation && activeConversation.id === msg.conversation_id) {
      messages.push(msg);
      const bubble = createMessageElement(msg);
      elements.messagesList.appendChild(bubble);
      scrollToBottom(true);
      // Mark read
      if (msg.sender_id !== currentUser.id) {
        WSClient.sendRead(activeConversation.id);
      }
    } else {
      // Incoming message for another conversation -> notify!
      const conv = conversations.find(c => c.id === msg.conversation_id);
      const convName = conv ? conv.name || (conv.other_user && (conv.other_user.display_name || conv.other_user.username)) : null;
      if (msg.sender_id !== currentUser.id) {
        Notifications.notifyNewMessage(msg, convName, () => {
          if (conv) selectConversation(conv);
        });
      }
    }

    // Update conversation item snippet and unread counter in sidebar
    const convIndex = conversations.findIndex(c => c.id === msg.conversation_id);
    if (convIndex !== -1) {
      const conv = conversations[convIndex];
      conv.last_message = msg;
      if (!activeConversation || activeConversation.id !== conv.id) {
        conv.unread_count = (conv.unread_count || 0) + 1;
      }
      // Bump conversation to top of list
      conversations.splice(convIndex, 1);
      conversations.unshift(conv);
      renderConversationsList(elements.convSearchInput ? elements.convSearchInput.value : '');
    } else {
      // New conversation created, refresh
      loadConversations();
    }
  };

  const handleMessageEdited = (msg) => {
    const idx = messages.findIndex(m => m.id === msg.id);
    if (idx !== -1) {
      messages[idx] = msg;
    }
    const el = document.getElementById(`msg-${msg.id}`);
    if (el) {
      const newEl = createMessageElement(msg);
      el.replaceWith(newEl);
    }
  };

  const handleMessageDeleted = (data) => {
    const idx = messages.findIndex(m => m.id === data.id);
    if (idx !== -1) {
      messages[idx].is_deleted = true;
      messages[idx].content = 'This message was deleted';
      messages[idx].attachments = [];
    }
    const el = document.getElementById(`msg-${data.id}`);
    if (el) {
      const newEl = createMessageElement(messages[idx]);
      el.replaceWith(newEl);
    }
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

  const handleReadReceipt = (data) => {
    if (activeConversation && activeConversation.id === data.conversation_id) {
      // Update ticks on sent messages to Read
      messages.forEach(m => {
        if (m.sender_id === currentUser.id) {
          m.status = 'READ';
        }
      });
      Utils.$$('.status-ticks', elements.messagesList).forEach(el => {
        el.className = 'status-ticks ticks-read';
        el.textContent = '✓✓';
        el.title = 'Read';
      });
    }
  };

  const updateUserPresence = (userId, isOnline, lastSeen) => {
    // Update sidebar dot
    const dot = document.getElementById(`status-dot-${userId}`);
    if (dot) {
      dot.className = `online-dot ${isOnline ? 'online' : 'offline'}`;
    }

    // Update active chat header if current 1-on-1 contact
    if (activeConversation && activeConversation.type === 'DIRECT' && activeConversation.other_user && activeConversation.other_user.id === userId) {
      activeConversation.other_user.is_online = isOnline;
      if (lastSeen) activeConversation.other_user.last_seen = lastSeen;
      const text = Utils.formatLastSeen(isOnline, activeConversation.other_user.last_seen);
      elements.chatSubtitle.textContent = text;
      elements.chatHeaderStatus.className = `status-text ${isOnline ? 'online-text' : ''}`;
    }
  };

  // Attachment handling
  const handleFileUpload = async (file) => {
    if (!file) return;

    if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) {
      Utils.showToast(`File exceeds ${CONFIG.MAX_FILE_SIZE_MB}MB limit`, 'error');
      return;
    }

    Utils.showToast(`Uploading ${file.name}...`, 'info');
    try {
      const uploaded = await API.uploadFile(file);
      pendingAttachments.push(uploaded);
      renderAttachmentPreviews();
    } catch (err) {
      Utils.showToast('Upload failed: ' + err.message, 'error');
    }
  };

  const renderAttachmentPreviews = () => {
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
        <button class="chip-remove" data-index="${index}">✕</button>
      `;
      item.querySelector('.chip-remove').addEventListener('click', () => {
        pendingAttachments.splice(index, 1);
        renderAttachmentPreviews();
      });
      elements.attachmentPreviews.appendChild(item);
    });
  };

  // Event Listeners for UI
  const bindUIEvents = () => {
    // Send button click
    elements.btnSendMessage.addEventListener('click', sendMessage);

    // Message input enter key
    elements.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Keystroke for typing indicator
    elements.messageInput.addEventListener('input', handleKeystroke);

    // Cancel reply / edit
    elements.btnCancelReply.addEventListener('click', hideReplyPreview);
    elements.btnCancelEdit.addEventListener('click', hideEditPreview);

    // Attachment button
    elements.btnAttachment.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileUpload(e.target.files[0]);
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
        handleKeystroke();
      });
    });

    document.addEventListener('click', (e) => {
      if (!elements.emojiPickerPopup.contains(e.target) && e.target !== elements.btnEmoji) {
        elements.emojiPickerPopup.classList.add('hidden');
      }
    });

    // Mobile back button
    elements.btnMobileBack.addEventListener('click', () => {
      document.body.classList.remove('mobile-chat-open');
    });

    // Live search in conversations sidebar
    elements.convSearchInput.addEventListener('input', Utils.debounce((e) => {
      renderConversationsList(e.target.value);
    }, 200));

    // Logout button
    elements.btnLogout.addEventListener('click', () => {
      if (confirm('Are you sure you want to log out?')) {
        Auth.logout();
      }
    });

    // Modal triggers
    elements.btnNewChat.addEventListener('click', () => setupNewChatModal());
    elements.btnNewGroup.addEventListener('click', () => setupNewGroupModal());
    elements.btnSettings.addEventListener('click', () => setupSettingsModal());
    elements.btnSearchMessages.addEventListener('click', () => setupSearchMessagesModal());
    elements.btnChatInfo.addEventListener('click', () => setupChatInfoModal());

    // Generic modal close buttons
    Utils.$$('.modal-close, .btn-modal-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });

    // Auto-grow textarea
    elements.messageInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
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
        resultsContainer.innerHTML = `<div class="empty-list-notice error-text">${err.message}</div>`;
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
          <img src="${API.resolveUrl(u.avatar_url) || `https://api.dicebear.com/7.x/initials/svg?seed=${u.username}`}" class="user-avatar-sm" />
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

      try {
        const newGroup = await Groups.create(name, selectedIds, groupDescInput.value.trim());
        Utils.closeModal('modal-new-group');
        Utils.showToast(`Group "${name}" created!`, 'success');
        await loadConversations();
        selectConversation(newGroup);
      } catch (err) {
        Utils.showToast(err.message, 'error');
      }
    };
  };

  // --- Modal: Search Messages ---
  const setupSearchMessagesModal = () => {
    Utils.openModal('modal-search-messages');
    const input = Utils.$('#search-query-input');
    const resultsContainer = Utils.$('#search-messages-results');
    input.value = '';
    resultsContainer.innerHTML = '<div class="empty-list-notice">Type a keyword to search message history...</div>';

    input.oninput = Utils.debounce(async () => {
      const q = input.value.trim();
      if (!q) {
        resultsContainer.innerHTML = '<div class="empty-list-notice">Type a keyword to search message history...</div>';
        return;
      }
      try {
        const matches = await API.get('/search/messages', { q });
        if (matches.length === 0) {
          resultsContainer.innerHTML = '<div class="empty-list-notice">No messages found matching query.</div>';
          return;
        }

        resultsContainer.innerHTML = '';
        matches.forEach(m => {
          const item = document.createElement('div');
          item.className = 'search-result-item';
          item.innerHTML = `
            <div class="result-conv-name">${Utils.escapeHTML(m.conversation_name)}</div>
            <div class="result-sender">${Utils.escapeHTML(m.sender_name)}: <span class="result-content">${Utils.escapeHTML(m.content)}</span></div>
            <div class="result-time">${Utils.formatMessageTime(m.created_at)}</div>
          `;
          item.addEventListener('click', async () => {
            Utils.closeModal('modal-search-messages');
            const conv = conversations.find(c => c.id === m.conversation_id);
            if (conv) {
              await selectConversation(conv);
              setTimeout(() => {
                const targetMsg = document.getElementById(`msg-${m.message_id}`);
                if (targetMsg) targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 400);
            }
          });
          resultsContainer.appendChild(item);
        });
      } catch (err) {
        resultsContainer.innerHTML = `<div class="empty-list-notice error-text">${err.message}</div>`;
      }
    }, 250);
  };

  // --- Modal: Chat & Group Info ---
  const setupChatInfoModal = () => {
    if (!activeConversation) return;
    Utils.openModal('modal-group-info');

    const isGroup = activeConversation.type === 'GROUP';
    const title = activeConversation.name || (activeConversation.other_user && (activeConversation.other_user.display_name || activeConversation.other_user.username));
    const avatar = API.resolveUrl(activeConversation.avatar_url) || `https://api.dicebear.com/7.x/initials/svg?seed=${title}`;

    Utils.$('#group-info-avatar').src = avatar;
    Utils.$('#group-info-name').textContent = title;
    Utils.$('#group-info-desc').textContent = activeConversation.description || (isGroup ? 'No description' : (activeConversation.other_user?.bio || 'No bio'));

    const membersSection = Utils.$('#group-members-section');
    const memberList = Utils.$('#group-members-list');
    const btnLeaveGroup = Utils.$('#btn-leave-group');
    const btnBlockUser = Utils.$('#btn-block-contact');

    if (isGroup) {
      membersSection.classList.remove('hidden');
      btnLeaveGroup.classList.remove('hidden');
      btnBlockUser.classList.add('hidden');

      memberList.innerHTML = '';
      activeConversation.members.forEach(m => {
        const item = document.createElement('div');
        item.className = 'member-item';
        const u = m.user;
        const uAvatar = API.resolveUrl(u?.avatar_url) || `https://api.dicebear.com/7.x/initials/svg?seed=${u?.username}`;
        item.innerHTML = `
          <img src="${uAvatar}" class="user-avatar-sm" />
          <div class="member-info">
            <span class="member-name">${Utils.escapeHTML(u?.display_name || u?.username)}</span>
            <span class="member-role ${m.role === 'ADMIN' ? 'admin-badge' : ''}">${m.role}</span>
          </div>
          ${isGroupAdmin(activeConversation) && m.user_id !== currentUser.id ? `
            <button class="btn btn-sm btn-danger btn-remove-member" data-id="${m.user_id}">Remove</button>
          ` : ''}
        `;

        const removeBtn = item.querySelector('.btn-remove-member');
        if (removeBtn) {
          removeBtn.addEventListener('click', async () => {
            if (confirm(`Remove member?`)) {
              await Groups.removeMember(activeConversation.id, m.user_id);
              Utils.showToast('Member removed', 'info');
              activeConversation.members = activeConversation.members.filter(mem => mem.user_id !== m.user_id);
              setupChatInfoModal();
            }
          });
        }

        memberList.appendChild(item);
      });

      btnLeaveGroup.onclick = async () => {
        if (confirm('Leave this group?')) {
          await Groups.leave(activeConversation.id);
          Utils.closeModal('modal-group-info');
          activeConversation = null;
          elements.activeChatWindow.classList.add('hidden');
          elements.emptyChatState.classList.remove('hidden');
          await loadConversations();
        }
      };
    } else {
      // 1-on-1 Chat Info
      membersSection.classList.add('hidden');
      btnLeaveGroup.classList.add('hidden');
      btnBlockUser.classList.remove('hidden');

      btnBlockUser.onclick = async () => {
        if (confirm(`Block ${title}?`)) {
          await Users.blockUser(activeConversation.other_user.id);
          Utils.closeModal('modal-group-info');
          activeConversation = null;
          elements.activeChatWindow.classList.add('hidden');
          elements.emptyChatState.classList.remove('hidden');
          await loadConversations();
        }
      };
    }
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
      };
    });

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
      try {
        const dName = Utils.$('#settings-display-name').value.trim();
        const bio = Utils.$('#settings-bio').value.trim();
        await ProfileManager.updateProfile(dName, bio);
        initUserHeader();
      } catch (e) {}
    };

    // Save Privacy
    Utils.$('#btn-save-privacy').onclick = async () => {
      try {
        const lastSeen = Utils.$('#settings-show-last-seen').checked;
        const online = Utils.$('#settings-show-online').checked;
        const read = Utils.$('#settings-show-read').checked;
        await ProfileManager.updatePrivacy(lastSeen, online, read);
      } catch (e) {}
    };

    // Save Notifications
    Utils.$('#btn-save-notifications').onclick = async () => {
      const sound = Utils.$('#settings-sound-enabled').checked;
      const desktop = Utils.$('#settings-desktop-enabled').checked;
      if (desktop) {
        await Notifications.requestPermission();
      }
      Notifications.saveSettings({ soundEnabled: sound, desktopEnabled: desktop });
      Utils.showToast('Notification preferences saved!', 'success');
    };

    // Change Password
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

  // Initialize Application
  initUserHeader();
  initWebSocket();
  bindUIEvents();
  loadConversations();
});
