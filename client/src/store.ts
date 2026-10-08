import { create } from 'zustand'
import { api, clearTokens, getAccessToken, saveTokens } from './api'
import type { User } from './types'
import { loginWithPasskey } from './passkeys'

type AuthState = {
  user: User | null
  loading: boolean
  setUser: (user: User) => void
  boot: () => Promise<void>
  login: (identifier: string, password: string) => Promise<{ ticket?: string; demo_code?: string }>
  register: (input: { username: string; email: string; password: string; confirm_password: string; display_name: string }) => Promise<{ requires_otp: boolean; identifier?: string; demo_otp?: string }>
  verifyRegistrationOtp: (identifier: string, code: string) => Promise<void>
  verify2fa: (ticket: string, code: string) => Promise<void>
  otpLogin: (identifier: string, code: string) => Promise<{ ticket?: string; demo_code?: string }>
  passkeyLogin: (identifier: string) => Promise<void>
  logout: () => Promise<void>
}

type LoginResponse = { access_token?: string; refresh_token?: string; user?: User; requires_2fa?: boolean; ticket?: string; requires_otp?: boolean; identifier?: string; demo_otp?: string; demo_code?: string }

const cachedUser = () => { try { return JSON.parse(localStorage.getItem('chat_user_data') || 'null') as User | null } catch { return null } }
const accept = (data: LoginResponse, set: (partial: Partial<AuthState>) => void) => {
  if (!data.access_token || !data.user) throw new Error('Sign-in did not return an account.')
  saveTokens(data.access_token, data.refresh_token)
  localStorage.setItem('chat_user_data', JSON.stringify(data.user))
  set({ user: data.user })
}

export const useAuth = create<AuthState>((set) => ({
  user: cachedUser(),
  loading: true,
  setUser: user => { localStorage.setItem('chat_user_data', JSON.stringify(user)); set({ user }) },
  boot: async () => {
    if (!getAccessToken()) { set({ user: null, loading: false }); return }
    try {
      const user = await api<User>('/auth/me')
      localStorage.setItem('chat_user_data', JSON.stringify(user))
      set({ user })
    } catch { set({ user: null }) }
    finally { set({ loading: false }) }
  },
  login: async (identifier, password) => {
    const data = await api<LoginResponse>('/auth/login', { method: 'POST', body: { username_or_email: identifier, password } })
    if (data.requires_2fa) return { ticket: data.ticket, demo_code: data.demo_code }
    accept(data, set)
    return {}
  },
  register: async input => {
    const data = await api<LoginResponse>('/auth/register', { method: 'POST', body: input })
    if (!data.requires_otp) accept(data, set)
    return { requires_otp: !!data.requires_otp, identifier: data.identifier, demo_otp: data.demo_otp }
  },
  verifyRegistrationOtp: async (identifier, code) => {
    const data = await api<LoginResponse>('/auth/otp/verify', { method: 'POST', body: { identifier, otp_code: code, purpose: 'REGISTER' } })
    accept(data, set)
  },
  verify2fa: async (ticket, code) => {
    const data = await api<LoginResponse>('/auth/2fa/verify', { method: 'POST', body: { ticket, code } })
    accept(data, set)
  },
  otpLogin: async (identifier, code) => {
    const data = await api<LoginResponse>('/auth/otp/verify', { method: 'POST', body: { identifier, otp_code: code, purpose: 'LOGIN' } })
    if (data.requires_2fa) return { ticket: data.ticket, demo_code: data.demo_code }
    accept(data, set)
    return {}
  },
  passkeyLogin: async identifier => { accept(await loginWithPasskey(identifier), set) },
  logout: async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch { /* local sign-out still completes */ }
    clearTokens()
    set({ user: null })
  },
}))
