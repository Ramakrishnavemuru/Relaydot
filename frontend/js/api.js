// API Client Wrapper
const API = {
  getToken: () => localStorage.getItem(CONFIG.TOKEN_KEY),

  setToken: (token) => localStorage.getItem(CONFIG.TOKEN_KEY) ? localStorage.setItem(CONFIG.TOKEN_KEY, token) : localStorage.setItem(CONFIG.TOKEN_KEY, token),

  removeToken: () => localStorage.removeItem(CONFIG.TOKEN_KEY),

  // Core request handler
  request: async (endpoint, options = {}) => {
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
        headers
      });

      // Handle 401 Unauthorized
      if (response.status === 401) {
        API.removeToken();
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
      headers,
      body: formData
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || 'Failed to upload file');
    }

    return await response.json();
  },

  // Helper to resolve attachment or avatar URLs
  resolveUrl: (url) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
      return url;
    }
    return `${CONFIG.FILE_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }
};
