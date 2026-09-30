// API Client Wrapper with HttpOnly cookie support and automatic refresh token rotation
const API = {
  getToken: () => localStorage.getItem(CONFIG.TOKEN_KEY),
  setToken: (token) => localStorage.setItem(CONFIG.TOKEN_KEY, token),
  removeToken: () => localStorage.removeItem(CONFIG.TOKEN_KEY),

  getRefreshToken: () => localStorage.getItem(CONFIG.REFRESH_TOKEN_KEY || 'chat_refresh_token'),
  setRefreshToken: (token) => localStorage.setItem(CONFIG.REFRESH_TOKEN_KEY || 'chat_refresh_token', token),
  removeRefreshToken: () => localStorage.removeItem(CONFIG.REFRESH_TOKEN_KEY || 'chat_refresh_token'),

  isRefreshing: false,
  refreshSubscribers: [],

  onRefreshed: (newToken) => {
    API.refreshSubscribers.forEach(callback => callback(newToken));
    API.refreshSubscribers = [];
  },

  addRefreshSubscriber: (callback) => {
    API.refreshSubscribers.push(callback);
  },

  // Core request handler
  request: async (endpoint, options = {}, isRetry = false) => {
    const url = endpoint.startsWith('http') ? endpoint : `${CONFIG.API_BASE_URL}${endpoint}`;
    const token = API.getToken();

    const headers = {
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Default to JSON body if not FormData
    if (options.body && !(options.body instanceof FormData) && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include', // Ensures HttpOnly cookies are passed and received
        headers
      });

      // Handle 401 Unauthorized with token refresh rotation
      if (response.status === 401 && !isRetry && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/logout')) {
        if (!API.isRefreshing) {
          API.isRefreshing = true;
          try {
            const refreshPayload = API.getRefreshToken() ? { refresh_token: API.getRefreshToken() } : {};
            const refreshRes = await fetch(`${CONFIG.API_BASE_URL}/auth/refresh`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(refreshPayload)
            });

            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              if (refreshData.access_token) {
                API.setToken(refreshData.access_token);
              }
              if (refreshData.refresh_token) {
                API.setRefreshToken(refreshData.refresh_token);
              }
              API.isRefreshing = false;
              API.onRefreshed(refreshData.access_token);
              return API.request(endpoint, options, true);
            }
          } catch (e) {
            console.warn('Auto-refresh failed:', e);
          }
          API.isRefreshing = false;
        } else {
          // Queue request until refresh completes
          return new Promise((resolve, reject) => {
            API.addRefreshSubscriber(newToken => {
              options.headers = { ...options.headers, 'Authorization': `Bearer ${newToken}` };
              resolve(API.request(endpoint, options, true));
            });
          });
        }

        // Refresh failed: clear credentials and redirect
        API.removeToken();
        API.removeRefreshToken();
        localStorage.removeItem(CONFIG.USER_KEY);
        if (!window.location.pathname.endsWith('login.html') && !window.location.pathname.endsWith('register.html')) {
          window.location.href = 'login.html';
        }
        throw new Error('Session expired. Please log in again.');
      }

      const contentType = response.headers.get('content-type');
      let data = null;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        const errorDetail = (data && data.detail) || response.statusText || 'An unexpected error occurred';
        throw new Error(typeof errorDetail === 'string' ? errorDetail : JSON.stringify(errorDetail));
      }

      return data;
    } catch (err) {
      console.error(`API Error [${options.method || 'GET'} ${endpoint}]:`, err);
      throw err;
    }
  },

  get: (endpoint, params = {}) => {
    let url = endpoint;
    const query = new URLSearchParams();
    Object.keys(params).forEach(k => {
      if (params[k] !== undefined && params[k] !== null) {
        query.append(k, params[k]);
      }
    });
    const queryString = query.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
    return API.request(url, { method: 'GET' });
  },

  post: (endpoint, body) => API.request(endpoint, { method: 'POST', body }),

  put: (endpoint, body) => API.request(endpoint, { method: 'PUT', body }),

  delete: (endpoint) => API.request(endpoint, { method: 'DELETE' }),

  uploadFile: async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    const token = API.getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${CONFIG.API_BASE_URL}/uploads`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || 'Failed to upload file');
    }

    return await response.json();
  },

  resolveUrl: (url) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
      return url;
    }
    return `${CONFIG.FILE_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }
};
