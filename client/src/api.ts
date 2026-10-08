const ACCESS_KEY = 'chat_access_token'
const REFRESH_KEY = 'chat_refresh_token'

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }
let refreshInFlight: Promise<void> | null = null

export const getAccessToken = () => localStorage.getItem(ACCESS_KEY)
export const saveTokens = (access: string, refresh?: string) => {
  localStorage.setItem(ACCESS_KEY, access)
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
}
export const clearTokens = () => {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem('chat_user_data')
}

async function renew() {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: localStorage.getItem(REFRESH_KEY) }),
  })
  if (!response.ok) throw new Error('Your session has expired. Please sign in again.')
  const data = await response.json() as { access_token: string; refresh_token?: string }
  saveTokens(data.access_token, data.refresh_token)
}

export async function api<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const originalToken = getAccessToken()
  const headers = new Headers(options.headers)
  if (originalToken) headers.set('Authorization', `Bearer ${originalToken}`)
  const body = options.body instanceof FormData ? options.body : options.body == null ? undefined : JSON.stringify(options.body)
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(path.startsWith('/api/') ? path : `/api${path}`, {
    ...options, headers, body, credentials: 'include',
  })
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      if (getAccessToken() === originalToken) {
        refreshInFlight ??= renew().finally(() => { refreshInFlight = null })
        await refreshInFlight
      }
      return api<T>(path, options, false)
    } catch {
      clearTokens()
      window.dispatchEvent(new Event('relay-session-expired'))
      throw new Error('Your session has expired. Please sign in again.')
    }
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: unknown } | null
    throw new Error(typeof data?.detail === 'string' ? data.detail : response.statusText || 'Request failed')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const query = (path: string, params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  return `${path}${search.size ? `?${search}` : ''}`
}

export const mediaUrl = (value?: string | null) => value || ''

export async function upload(file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<{ file_url: string; file_name: string; file_type: string; file_size: number }>('/uploads', { method: 'POST', body: form })
}
