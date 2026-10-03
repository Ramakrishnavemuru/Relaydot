// User Profile & Settings Management
const ProfileManager = {
  loadProfileData: async () => {
    try {
      const user = await Auth.fetchMyProfile();
      return user;
    } catch (err) {
      Utils.showToast('Your profile couldn’t load. Please try again.', 'error');
      return null;
    }
  },

  updateProfile: async (displayName, bio, avatarUrl, coverUrl, website) => {
    try {
      const updated = await API.put('/users/profile', {
        display_name: displayName,
        bio: bio,
        avatar_url: avatarUrl,
        cover_url: coverUrl,
        website
      });
      Auth.setCurrentUser({...Auth.getCurrentUser(),...updated});
      Utils.showToast('Profile updated successfully!', 'success');
      return updated;
    } catch (err) {
      Utils.showToast('Your changes couldn’t be saved. Please try again.', 'error');
      throw err;
    }
  },

  updatePrivacy: async (showLastSeen, showOnline, showReadReceipts) => {
    try {
      const updated = await API.put('/users/privacy', {
        show_last_seen: showLastSeen,
        show_online: showOnline,
        show_read_receipts: showReadReceipts
      });
      Auth.setCurrentUser({...Auth.getCurrentUser(),...updated});
      Utils.showToast('Privacy settings updated!', 'success');
      return updated;
    } catch (err) {
      Utils.showToast('Your changes couldn’t be saved. Please try again.', 'error');
      throw err;
    }
  },

  uploadAvatar: async (file) => {
    try {
      if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, or GIF image.');
      if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) throw new Error(`Choose a photo smaller than ${CONFIG.MAX_FILE_SIZE_MB} MB.`);
      const uploadRes = await API.uploadFile(file);
      return uploadRes.file_url;
    } catch (err) {
      Utils.showToast(err.message || 'Avatar upload failed', 'error');
      throw err;
    }
  }
};
