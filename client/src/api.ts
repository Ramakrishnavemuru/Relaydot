type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }
let refreshInFlight: Promise<void> | null = null

export const clearTokens = () => {
  try {
    localStorage.removeItem('chat_access_token')
    localStorage.removeItem('chat_refresh_token')
    localStorage.removeItem('chat_user_data')
  } catch { /* Cookie sign-out still completes when storage is disabled. */ }
}

async function renew() {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!response.ok) throw new Error('Your session has expired. Please sign in again.')
}

export async function api<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const headers = new Headers(options.headers)
  const body = options.body instanceof FormData ? options.body : options.body == null ? undefined : JSON.stringify(options.body)
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort('timeout'), body instanceof FormData ? 120_000 : 30_000)
  let response: Response
  try {
    response = await fetch(path.startsWith('/api/') ? path : `/api${path}`, {
      ...options, headers, body, credentials: 'include', signal: controller.signal,
    })
  } catch (cause) {
    if (controller.signal.reason === 'timeout') throw new Error('Request timed out. Please try again.')
    throw cause
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      refreshInFlight ??= renew().finally(() => { refreshInFlight = null })
      await refreshInFlight
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

export const imagePreviewUrl = (value?: string | null, width = 640) => {
  if (!value || !/^https:\/\/res\.cloudinary\.com\//.test(value) ||
      !value.includes('/image/upload/') || value.includes('/s--') || value.includes('?')) return mediaUrl(value)
  return value.replace('/image/upload/', `/image/upload/f_auto,q_auto,c_limit,w_${Math.min(1600, Math.max(64, Math.round(width)))}/`)
}

export async function upload(file: File) {
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
  return api<{ file_url: string; file_name: string; file_type: string; file_size: number }>('/uploads', { method: 'POST', body: form })
}
