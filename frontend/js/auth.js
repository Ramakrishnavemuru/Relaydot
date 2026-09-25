// Authentication Manager
const Auth = {
  getCurrentUser: () => {
    try {
      const data = localStorage.getItem(CONFIG.USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  setCurrentUser: (user) => {
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
  },

  isAuthenticated: () => {
    return !!API.getToken();
  },

  login: async (usernameOrEmail, password) => {
    const data = await API.post('/auth/login', {
      username_or_email: usernameOrEmail,
      password: password
    });

    if (data.access_token) {
      API.setToken(data.access_token);
      Auth.setCurrentUser(data.user);
      return data.user;
    }
    throw new Error('Failed to retrieve authentication token.');
  },

  register: async (username, email, password, confirmPassword, displayName) => {
    const data = await API.post('/auth/register', {
      username,
      email,
      password,
      confirm_password: confirmPassword,
      display_name: displayName || username
    });

    if (data.access_token) {
      API.setToken(data.access_token);
      Auth.setCurrentUser(data.user);
      return data.user;
    }
    throw new Error('Failed to register user.');
  },

  logout: async () => {
    try {
      if (Auth.isAuthenticated()) {
        await API.post('/auth/logout');
      }
    } catch (e) {
      console.warn('Logout API call error:', e);
    } finally {
      API.removeToken();
      localStorage.removeItem(CONFIG.USER_KEY);
      if (window.WSClient) {
        WSClient.disconnect();
      }
      window.location.href = 'login.html';
    }
  },

  changePassword: async (currentPassword, newPassword, confirmNewPassword) => {
    return await API.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
      confirm_new_password: confirmNewPassword
    });
  },

  forgotPassword: async (email) => {
    return await API.post('/auth/forgot-password', { email });
  },

  resetPassword: async (email, resetCode, newPassword) => {
    return await API.post('/auth/reset-password', {
      email,
      reset_code: resetCode,
      new_password: newPassword
    });
  },

  fetchMyProfile: async () => {
    const user = await API.get('/auth/me');
    Auth.setCurrentUser(user);
    return user;
  },

  // Route Guards
  requireAuth: () => {
    if (!Auth.isAuthenticated()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  },

  redirectIfAuthenticated: () => {
    if (Auth.isAuthenticated()) {
      window.location.href = 'chat.html';
      return true;
    }
    return false;
  }
};
