import { api } from './api'
import type { User } from './types'

const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0)).buffer
const encode = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

type CredentialDescriptor = Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }
type CreationOptions = Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> & {
  challenge: string; user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string }; excludeCredentials?: CredentialDescriptor[]
}
type RequestOptions = Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> & { challenge: string; challenge_id: string; allowCredentials?: CredentialDescriptor[] }

export const passkeysSupported = () => !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials)

export async function registerPasskey(name: string) {
  if (!passkeysSupported()) throw new Error('Passkeys are unavailable in this browser.')
  const options = await api<CreationOptions>('/auth/passkeys/register/options', { method: 'POST' })
  const credential = await navigator.credentials.create({ publicKey: {
    ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map(item => ({ ...item, id: decode(item.id) })),
  } }) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey creation was cancelled.')
  const response = credential.response as AuthenticatorAttestationResponse
  return api('/auth/passkeys/register/verify', { method: 'POST', body: { name, response: {
    id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    response: { attestationObject: encode(response.attestationObject), clientDataJSON: encode(response.clientDataJSON), transports: response.getTransports?.() || [] },
  } } })
}

export async function loginWithPasskey(identifier: string) {
  if (!passkeysSupported()) throw new Error('Passkeys are unavailable in this browser.')
  const suffix = identifier ? `?identifier=${encodeURIComponent(identifier)}` : ''
  const options = await api<RequestOptions>(`/auth/passkeys/login/options${suffix}`, { method: 'POST' })
  const { challenge_id, ...publicKeyOptions } = options
  const credential = await navigator.credentials.get({ publicKey: {
    ...publicKeyOptions, challenge: decode(options.challenge), allowCredentials: options.allowCredentials?.map(item => ({ ...item, id: decode(item.id) })),
  } }) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey sign-in was cancelled.')
  const response = credential.response as AuthenticatorAssertionResponse
  return api<{ access_token: string; refresh_token?: string; user: User }>('/auth/passkeys/login/verify', { method: 'POST', body: { challenge_id, response: {
    id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    response: { authenticatorData: encode(response.authenticatorData), clientDataJSON: encode(response.clientDataJSON), signature: encode(response.signature), userHandle: response.userHandle ? encode(response.userHandle) : null },
  } } })
}
