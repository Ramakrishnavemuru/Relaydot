import { create } from 'zustand'
import { api, clearTokens } from './api'
import type { User } from './types'
import { loginWithPasskey } from './passkeys'

type AuthState = {
  user: User | null
  loading: boolean
  setUser: (user: User) => void
  boot: () => Promise<void>
  login: (identifier: string, password: string) => Promise<{ ticket?: string; demo_code?: string }>
  staffLogin: (identifier: string, password: string) => Promise<{ ticket?: string }>
  staffVerify2fa: (ticket: string, code: string) => Promise<void>
  register: (input: { username: string; email: string; password: string; confirm_password: string; display_name: string }) => Promise<{ requires_otp: boolean; identifier?: string; demo_otp?: string }>
  verifyRegistrationOtp: (identifier: string, code: string) => Promise<void>
  verify2fa: (ticket: string, code: string) => Promise<void>
  otpLogin: (identifier: string, code: string) => Promise<{ ticket?: string; demo_code?: string }>
  passkeyLogin: (identifier: string) => Promise<void>
  logout: () => Promise<void>
}

type LoginResponse = { access_token?: string; refresh_token?: string; user?: User; requires_2fa?: boolean; ticket?: string; requires_otp?: boolean; identifier?: string; demo_otp?: string; demo_code?: string }

const accept = (data: LoginResponse, set: (partial: Partial<AuthState>) => void) => {
  if (!data.user) throw new Error('Sign-in did not return an account.')
  // Auth cookies are HttpOnly; discard tokens left by older development builds.
  try {
    localStorage.removeItem('chat_access_token')
    localStorage.removeItem('chat_refresh_token')
  } catch { /* Storage may be disabled. */ }
  set({ user: data.user })
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  setUser: user => set({ user }),
  boot: async () => {
    try {
      localStorage.removeItem('chat_user_data')
      localStorage.removeItem('chat_access_token')
      localStorage.removeItem('chat_refresh_token')
    } catch { /* Storage may be disabled; cookies remain authoritative. */ }
    try {
      let user: User
      try { user = await api<User>('/auth/me') }
      catch { await api('/auth/refresh', { method: 'POST', body: {} }); user = await api<User>('/auth/me') }
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
  staffLogin: async (identifier, password) => {
    const data = await api<LoginResponse>('/staff/auth/login', { method: 'POST', body: { username_or_email: identifier, password } })
    if (!data.requires_2fa || !data.ticket) throw new Error('Staff MFA is required.')
    return { ticket: data.ticket }
  },
  staffVerify2fa: async (ticket, code) => {
    const data = await api<LoginResponse>('/staff/auth/verify', { method: 'POST', body: { ticket, code } })
    accept(data, set)
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
