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
    const avatar = API.resolveUrl(user.avatar_url) || `https://api.dicebear.com/7.x/initials/svg?seed=${user.username}`;
    
    item.innerHTML = `
      <div class="user-avatar-wrap">
        <img src="${avatar}" alt="${Utils.escapeHTML(user.username)}" class="user-avatar" />
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

    item.addEventListener('click', () => onSelect(user));

    return item;
  }
};
