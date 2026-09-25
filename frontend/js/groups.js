// Group Chat Management
const Groups = {
  create: async (name, memberIds = [], description = '', avatarUrl = null) => {
    return await API.post('/groups', {
      name,
      member_ids: memberIds,
      description,
      avatar_url: avatarUrl
    });
  },

  update: async (conversationId, name, description, avatarUrl) => {
    return await API.put(`/groups/${conversationId}`, {
      name,
      description,
      avatar_url: avatarUrl
    });
  },

  addMember: async (conversationId, userId, role = 'MEMBER') => {
    return await API.post(`/groups/${conversationId}/members`, {
      user_id: userId,
      role
    });
  },

  removeMember: async (conversationId, userId) => {
    return await API.delete(`/groups/${conversationId}/members/${userId}`);
  },

  leave: async (conversationId) => {
    return await API.post(`/groups/${conversationId}/leave`);
  }
};
