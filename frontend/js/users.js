// User Management, User Search & Blocking
const Users = {
  // Search users by username or email
  search: async (query) => {
    if (!query || query.trim().length === 0) return [];
    return await API.get('/users/search', { q: query.trim() });
  },

  // Get user profile by ID
  getProfile: async (userId) => {
    return await API.get(`/users/${userId}`);
  },

  // Block a user
  blockUser: async (userId) => {
    const res = await API.post(`/users/${userId}/block`);
    Utils.showToast('User has been blocked', 'info');
    return res;
  },

  // Unblock a user
  unblockUser: async (userId) => {
    const res = await API.delete(`/users/${userId}/block`);
    Utils.showToast('User has been unblocked', 'success');
    return res;
  },

  // List blocked users
  getBlockedUsers: async () => {
    return await API.get('/users/blocked/list');
  },

  // Render User Search Item
  renderUserItem: (user, onSelect) => {
    const item = document.createElement('div');
    item.className = 'user-search-item';
    const avatar = AppUI.avatarUrl(user.avatar_url,user.display_name || user.username);
    
    item.innerHTML = `
      <div class="user-avatar-wrap">
        <img src="${Utils.escapeHTML(avatar)}" alt="${Utils.escapeHTML(user.username)}" class="user-avatar" />
        <span class="online-dot ${user.is_online ? 'online' : 'offline'}"></span>
      </div>
      <div class="user-info">
        <div class="user-name">${Utils.escapeHTML(user.display_name || user.username)}</div>
        <div class="user-handle">@${Utils.escapeHTML(user.username)}</div>
        ${user.bio ? `<div class="user-bio">${Utils.escapeHTML(user.bio)}</div>` : ''}
      </div>
      <button class="btn btn-sm btn-primary action-btn">Message</button>
    `;

    item.querySelector('.action-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(user);
    });

    item.tabIndex = 0; item.setAttribute('role','group'); item.setAttribute('aria-label',user.display_name || user.username);
    item.addEventListener('click', () => onSelect(user));
    item.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === item) { e.preventDefault(); onSelect(user); } });

    return item;
  }
};
