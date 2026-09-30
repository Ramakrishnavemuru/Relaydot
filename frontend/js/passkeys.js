// Passkeys / WebAuthn Client Helper
const Passkeys = {
  isSupported: () => {
    return !!(window.PublicKeyCredential && window.navigator.credentials && window.navigator.credentials.create);
  },

  bufferToBase64url: (buffer) => {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(str);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  },

  base64urlToBuffer: (base64url) => {
    if (!base64url) return new ArrayBuffer(0);
    let padding = '='.repeat((4 - (base64url.length % 4)) % 4);
    let base64 = (base64url + padding).replace(/\-/g, '+').replace(/_/g, '/');
    let raw = atob(base64);
    let buffer = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      buffer[i] = raw.charCodeAt(i);
    }
    return buffer.buffer;
  },

  // Register a new passkey on the current account
  register: async (name = 'My Passkey') => {
    if (!Passkeys.isSupported()) {
      throw new Error('Passkeys/WebAuthn is not supported in this browser or environment.');
    }

    // 1. Get options from server
    const options = await API.post('/auth/passkeys/register/options');

    // 2. Prepare WebAuthn Creation Options
    const creationOptions = {
      ...options,
      challenge: Passkeys.base64urlToBuffer(options.challenge),
      user: {
        ...options.user,
        id: Passkeys.base64urlToBuffer(options.user.id)
      }
    };

    if (options.excludeCredentials) {
      creationOptions.excludeCredentials = options.excludeCredentials.map(c => ({
        ...c,
        id: Passkeys.base64urlToBuffer(c.id)
      }));
    }

    // 3. Browser authentication prompt (Touch ID, Face ID, Windows Hello, Security Key)
    const credential = await navigator.credentials.create({
      publicKey: creationOptions
    });

    if (!credential) {
      throw new Error('Passkey creation was cancelled.');
    }

    // 4. Encode credential for backend verification
    const credentialResponse = {
      id: credential.id,
      rawId: Passkeys.bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        attestationObject: Passkeys.bufferToBase64url(credential.response.attestationObject),
        clientDataJSON: Passkeys.bufferToBase64url(credential.response.clientDataJSON),
        transports: credential.response.getTransports ? credential.response.getTransports() : []
      }
    };

    // 5. Send to server
    const result = await API.post('/auth/passkeys/register/verify', {
      name: name || 'My Passkey',
      response: credentialResponse
    });

    return result;
  },

  // Authenticate / Login passwordlessly using passkey
  login: async (identifier = null) => {
    if (!Passkeys.isSupported()) {
      throw new Error('Passkeys/WebAuthn is not supported in this browser or environment.');
    }

    // 1. Get authentication options from server
    const options = await API.post('/auth/passkeys/login/options', { identifier });

    // 2. Prepare WebAuthn Request Options
    const requestOptions = {
      ...options,
      challenge: Passkeys.base64urlToBuffer(options.challenge)
    };

    if (options.allowCredentials && options.allowCredentials.length > 0) {
      requestOptions.allowCredentials = options.allowCredentials.map(c => ({
        ...c,
        id: Passkeys.base64urlToBuffer(c.id)
      }));
    }

    // 3. Browser prompt
    const assertion = await navigator.credentials.get({
      publicKey: requestOptions
    });

    if (!assertion) {
      throw new Error('Passkey authentication cancelled.');
    }

    // 4. Encode response
    const assertionResponse = {
      id: assertion.id,
      rawId: Passkeys.bufferToBase64url(assertion.rawId),
      type: assertion.type,
      response: {
        authenticatorData: Passkeys.bufferToBase64url(assertion.response.authenticatorData),
        clientDataJSON: Passkeys.bufferToBase64url(assertion.response.clientDataJSON),
        signature: Passkeys.bufferToBase64url(assertion.response.signature),
        userHandle: assertion.response.userHandle ? Passkeys.bufferToBase64url(assertion.response.userHandle) : null
      }
    };

    // 5. Verify on server
    const data = await API.post('/auth/passkeys/login/verify', {
      response: assertionResponse
    });

    if (data.access_token) {
      API.setToken(data.access_token);
      if (data.refresh_token) API.setRefreshToken(data.refresh_token);
      Auth.setCurrentUser(data.user);
    }

    return data;
  }
};
