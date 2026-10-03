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

  // 1. Password Login
  login: async (identifier, password) => {
    const data = await API.post('/auth/login', {
      username_or_email: identifier,
      password: password
    });

    if (data.requires_2fa) {
      return {
        requires_2fa: true,
        ticket: data.ticket,
        methods: data.methods || ['totp', 'recovery_code', 'passkey']
      };
    }

    if (data.access_token) {
      API.setToken(data.access_token);
      if (data.refresh_token) API.setRefreshToken(data.refresh_token);
      Auth.setCurrentUser(data.user);
      return { user: data.user };
    }
    throw new Error('Authentication failed.');
  },

  // 2. Complete 2FA Login Challenge (TOTP code or Recovery Code)
  verify2FA: async (ticket, code) => {
    const data = await API.post('/auth/2fa/verify', {
      ticket,
      code
    });

    if (data.access_token) {
      API.setToken(data.access_token);
      if (data.refresh_token) API.setRefreshToken(data.refresh_token);
      Auth.setCurrentUser(data.user);
      return data.user;
    }
    throw new Error('2FA verification failed.');
  },

  // 3. OTP Authentication (Email or Phone number)
  sendOTP: async (identifier, purpose = 'LOGIN') => {
    return await API.post('/auth/otp/send', {
      identifier,
      purpose
    });
  },

  verifyOTP: async (identifier, otpCode, purpose = 'LOGIN') => {
    const data = await API.post('/auth/otp/verify', {
      identifier,
      otp_code: otpCode,
      purpose
    });

    if (data.requires_2fa) {
      return {
        requires_2fa: true,
        ticket: data.ticket,
        methods: data.methods
      };
    }

    if (data.access_token) {
      API.setToken(data.access_token);
      if (data.refresh_token) API.setRefreshToken(data.refresh_token);
      Auth.setCurrentUser(data.user);
      return { user: data.user };
    }
    return data;
  },

  // 4. Passkey Login (WebAuthn / Biometrics)
  loginWithPasskey: async (identifier = null) => {
    if (typeof Passkeys === 'undefined') {
      throw new Error('Passkeys module not loaded.');
    }
    const data = await Passkeys.login(identifier);
    return data;
  },

  // 5. Account Registration
  register: async (payload) => {
    const data = await API.post('/auth/register', payload);

    if (data.access_token) {
      API.setToken(data.access_token);
      if (data.refresh_token) API.setRefreshToken(data.refresh_token);
      Auth.setCurrentUser(data.user);
    }
    return data;
  },

  // 6. Logout
  logout: async () => {
    try {
      if (Auth.isAuthenticated()) {
        await API.post('/auth/logout');
      }
    } catch (e) {
      console.warn('Logout API call error:', e);
    } finally {
      API.removeToken();
      API.removeRefreshToken();
      localStorage.removeItem(CONFIG.USER_KEY);
      if (typeof WSClient !== 'undefined') {
        WSClient.disconnect();
      }
      window.location.href = 'login.html';
    }
  },

  // 7. Active Sessions & Devices Management
  fetchSessions: async () => {
    return await API.get('/auth/sessions');
  },

  revokeSession: async (sessionId) => {
    return await API.delete(`/auth/sessions/${sessionId}`);
  },

  revokeOtherSessions: async () => {
    return await API.post('/auth/sessions/revoke-others');
  },

  // 8. Two-Factor Authentication Management
  setup2FA: async () => {
    return await API.post('/auth/2fa/totp/setup');
  },

  enable2FA: async (code) => {
    return await API.post('/auth/2fa/totp/enable', { code });
  },

  disable2FA: async (code = null, password = null) => {
    return await API.post('/auth/2fa/totp/disable', { code, password });
  },

  // 9. Passkey Management
  registerPasskey: async (name = 'My Device Passkey') => {
    if (typeof Passkeys === 'undefined') {
      throw new Error('Passkeys module not loaded.');
    }
    return await Passkeys.register(name);
  },

  listPasskeys: async () => {
    return await API.get('/auth/passkeys');
  },

  deletePasskey: async (passkeyId) => {
    return await API.delete(`/auth/passkeys/${passkeyId}`);
  },

  // 10. Password & Profile
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
    const user = {...Auth.getCurrentUser(), ...await API.get('/auth/me')};
    Auth.setCurrentUser(user);
    return user;
  },

  // Route Guards
  requireAuth: () => {
    if (!Auth.isAuthenticated()) {
      const path = window.location.pathname + window.location.search;
      if (/^\/(?:social|chat|profile|settings)\.html(?:\?|$)/.test(path)) sessionStorage.setItem('relay-return-to', path);
      window.location.href = 'login.html';
      return false;
    }
    return true;
  },

  redirectIfAuthenticated: () => {
    if (Auth.isAuthenticated()) {
      window.location.href = Auth.consumeRedirect();
      return true;
    }
    return false;
  },

  consumeRedirect: () => {
    const path = sessionStorage.getItem('relay-return-to');
    sessionStorage.removeItem('relay-return-to');
    return path && /^\/(?:social|chat|profile|settings)\.html(?:\?|$)/.test(path) ? path : 'social.html';
  }
};
