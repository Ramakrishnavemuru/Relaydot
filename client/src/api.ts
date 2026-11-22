type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }
let csrfValue: string | null = null
let csrfLoadedAt = 0
let csrfFlight: Promise<Record<string, string>> | null = null
let authEpoch = 0

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError' }
}

export function resetSessionCache() {
  authEpoch++
  csrfValue = null
  csrfLoadedAt = 0
  csrfFlight = null
}

export const clearTokens = () => {
  resetSessionCache()
  try {
    localStorage.removeItem('chat_access_token')
    localStorage.removeItem('chat_refresh_token')
    localStorage.removeItem('chat_user_data')
  } catch { /* Storage may be unavailable. */ }
}

// The deadline covers both headers and the response body, including CSRF fetches.
async function requestJson(path: string, options: RequestInit, timeoutMs: number): Promise<{ response: Response; data: unknown }> {
  const controller = new AbortController()
  const signal = options.signal
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  let deadline: ReturnType<typeof setTimeout>
  let rejectDeadline: (cause: Error) => void
  const cancelled = new Promise<never>((_, reject) => { rejectDeadline = reject })
  const onAbort = () => rejectDeadline(controller.signal.reason === 'timeout'
    ? new Error('Request timed out. Please try again.') : new DOMException('Request cancelled', 'AbortError'))
  controller.signal.addEventListener('abort', onAbort, { once: true })
  deadline = setTimeout(() => controller.abort('timeout'), timeoutMs)
  try {
    if (controller.signal.aborted) onAbort()
    return await Promise.race([cancelled, (async () => {
      const response = await fetch(path, { ...options, credentials: 'include', signal: controller.signal })
      const data: unknown = response.status === 204 ? undefined : await response.json().catch(() => null)
      return { response, data }
    })()])
  } finally {
    clearTimeout(deadline)
    controller.signal.removeEventListener('abort', onAbort)
    signal?.removeEventListener('abort', abort)
  }
}

async function csrfHeaders(): Promise<Record<string, string>> {
  if (csrfValue && Date.now() - csrfLoadedAt < 300_000) return { 'X-CSRF-Token': csrfValue }
  if (csrfFlight) return csrfFlight
  const epoch = authEpoch
  const flight = requestJson('/api/auth/csrf', {}, 8_000).then(({ response, data }): Record<string, string> => {
    if (!response.ok) return {}
    const token = (data as { csrf_token?: string } | null)?.csrf_token
    if (!token) throw new Error('Could not verify this session. Please try again.')
    if (epoch === authEpoch) { csrfValue = token; csrfLoadedAt = Date.now() }
    return { 'X-CSRF-Token': token }
  })
  csrfFlight = flight
  try { return await flight } finally { if (csrfFlight === flight) csrfFlight = null }
}

export async function api<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const url = path.startsWith('/api/') ? path : `/api${path}`
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())
  const headers = new Headers(options.headers)
  if (unsafe && typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You’re offline. Reconnect and try again.')
  if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
  if (unsafe) for (const [key, value] of Object.entries(await csrfHeaders())) headers.set(key, value)
  if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
  const body = options.body instanceof FormData ? options.body : options.body == null ? undefined : JSON.stringify(options.body)
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const { response, data } = await requestJson(url, { ...options, headers, body }, body instanceof FormData ? 120_000 : 15_000)
  const detail = (data as { detail?: unknown } | null)?.detail
  // Retry only an explicit pre-action CSRF rejection (e.g. another tab rotated the cookie).
  if (retry && unsafe && response.status === 403 && detail === 'CSRF token missing or invalid') {
    resetSessionCache()
    return api<T>(path, options, false)
  }
  if (response.status === 401) {
    resetSessionCache()
    if (!url.startsWith('/api/auth/') && !url.startsWith('/api/staff/auth/')) window.dispatchEvent(new Event('relay-session-expired'))
  }
  if (!response.ok) throw new ApiError(typeof detail === 'string' ? detail : response.statusText || 'Request failed', response.status)
  if (response.status !== 204 && data == null) throw new Error('The server returned an unreadable response. Please try again.')
  if (unsafe && /^\/api\/(auth\/(login|register|refresh|logout|reauthenticate|2fa\/verify|otp\/verify|passkeys\/login\/verify)|staff\/auth\/(login|verify))$/.test(url)) resetSessionCache()
  return data as T
}

export const query = (path: string, params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  return `${path}${search.size ? `?${search}` : ''}`
}

export const mediaUrl = (value?: string | null) => value || ''

export const imagePreviewUrl = (value?: string | null, width = 640) => {
  if (!value || !/^https:\/\/res\.cloudinary\.com\//.test(value) ||
      !value.includes('/image/upload/') || value.includes('/s--') || value.includes('?')) return mediaUrl(value)
  return value.replace('/image/upload/', `/image/upload/f_auto,q_auto,c_limit,w_${Math.min(1600, Math.max(64, Math.round(width)))}/`)
}

export async function upload(file: File, destination: 'public' | 'chat' | 'post' = 'public') {
  const form = new FormData()
  let selected = file
  if (document.documentElement.dataset.mediaQuality !== 'original' &&
      /^image\/(jpeg|png|webp)$/.test(file.type) && file.size > 1_500_000) {
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .82))
      if (blob && blob.size < file.size) selected = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' })
    } catch { /* Keep the original if this browser cannot encode the image. */ }
  }
  form.append('file', selected)
  return api<{ file_url: string; file_name: string; file_type: string; file_size: number }>(destination === 'chat' ? '/messages/uploads' : destination === 'post' ? '/social/post-media' : '/uploads', { method: 'POST', body: form })
}
