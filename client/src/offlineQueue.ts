import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, upload } from './api'
import type { Post, User } from './types'

export type QueueStatus = 'Draft' | 'Queued' | 'Syncing' | 'Published' | 'Failed' | 'Action Required'
export type QueuedPost = {
  id: string
  userId: number
  content: string
  file?: File | null
  mediaUrl?: string | null
  mediaType?: 'IMAGE' | 'VIDEO' | 'GIF' | null
  pollOptions?: string[] | null
  collaboratorIds: number[]
  collaborators?: User[]
  createdAt: number
  status: QueueStatus
  attempts: number
  nextAttemptAt: number
  error?: string
  publishedPostId?: number
}

const databaseName = 'relaydot-offline-posts'
const storeName = 'posts'
const changed = () => window.dispatchEvent(new Event('relay-offline-queue-change'))

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Offline storage is unavailable in this browser.'))
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: 'id' })
        store.createIndex('userId', 'userId')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const result = operation(tx.objectStore(storeName))
    result.onerror = () => { db.close(); reject(result.error) }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error || result.error || new Error('Offline storage was interrupted.')) }
    tx.oncomplete = () => { resolve(result.result); db.close() }
  })
}

export async function queuedPosts(userId: number): Promise<QueuedPost[]> {
  const rows = await request('readonly', store => store.index('userId').getAll(userId)) as QueuedPost[]
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveQueuedPost(post: QueuedPost): Promise<void> {
  try {
    await request('readwrite', store => store.put(post))
    changed()
  } catch (cause) {
    if (cause instanceof DOMException && ['QuotaExceededError', 'UnknownError'].includes(cause.name)) {
      throw new Error('This device has no room for the offline attachment. Free storage or choose a smaller file.')
    }
    throw cause
  }
}

export async function deleteQueuedPost(id: string, userId: number): Promise<void> {
  const rows = await queuedPosts(userId)
  if (!rows.some(row => row.id === id && row.status !== 'Syncing')) return
  await request('readwrite', store => store.delete(id))
  changed()
}

let activeUser: number | null = null
let syncing = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
export function stopOfflineSync() {
  activeUser = null
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = undefined
  changed()
}

const announce = (message: string) => window.dispatchEvent(new CustomEvent('relay-offline-queue-toast', { detail: message }))

async function syncPostsWithinTab(userId: number, force = false): Promise<void> {
  if (syncing || !navigator.onLine) return
  activeUser = userId
  syncing = true
  try {
    const rows = await queuedPosts(userId)
    const pending = rows.filter(row => row.status !== 'Draft' && row.status !== 'Published' &&
      row.status !== 'Action Required' && (force || row.nextAttemptAt <= Date.now()))
    if (!pending.length) return
    try { await api('/social/notifications?limit=1') } catch {
      for (const row of pending) {
        row.nextAttemptAt = Date.now() + 15_000
        row.error = 'Waiting for the server to reconnect.'
        await saveQueuedPost(row)
      }
      return
    }
    for (const row of pending) {
      if (activeUser !== userId) break
      row.status = 'Syncing'
      await saveQueuedPost(row)
      try {
        if (row.file && !row.mediaUrl) {
          const media = await upload(row.file, 'post')
          row.mediaUrl = media.file_url
          await saveQueuedPost(row)
        }
        if (activeUser !== userId) break
        const post = await api<Post>('/social/posts', { method: 'POST', body: {
          client_id: row.id, content: row.content, media_url: row.mediaUrl || null,
          media_type: row.mediaType || null, poll_options: row.pollOptions || null,
          collaborator_ids: row.collaboratorIds,
        } })
        row.status = 'Published'
        row.publishedPostId = post.id
        row.file = null
        row.error = undefined
        await saveQueuedPost(row)
        announce('Your queued post was published.')
        window.dispatchEvent(new Event('relay-post-published'))
      } catch (cause) {
        row.attempts += 1
        row.error = cause instanceof Error ? cause.message : 'Could not publish this post.'
        const auth = (cause instanceof ApiError && cause.status === 401) || /session has expired|sign in again/i.test(row.error)
        const validation = /unsupported media|not found|invalid|join the community|choose unique|cannot invite/i.test(row.error)
        row.status = auth || validation ? 'Action Required' : 'Failed'
        row.nextAttemptAt = Date.now() + Math.min(300_000, 2_000 * 2 ** Math.min(row.attempts, 7))
        if (row.attempts >= 5) row.status = 'Action Required'
        await saveQueuedPost(row)
        announce(row.status === 'Action Required' ? 'A queued post needs your attention.' : 'A queued post failed. Relay will retry.')
        if (auth) break
      }
    }
  } finally {
    syncing = false
    if (activeUser === userId) {
      const rows = await queuedPosts(userId).catch(() => [])
      const next = rows.filter(row => ['Failed', 'Queued', 'Syncing'].includes(row.status) && row.attempts < 5 && row.nextAttemptAt > Date.now())
        .reduce((time, row) => Math.min(time, row.nextAttemptAt), Infinity)
      if (retryTimer) clearTimeout(retryTimer)
      if (next !== Infinity) retryTimer = setTimeout(() => void synchronizeOfflinePosts(userId), Math.max(1000, next - Date.now()))
    }
  }
}

export async function synchronizeOfflinePosts(userId: number, force = false): Promise<void> {
  if (navigator.locks) {
    await navigator.locks.request(`relaydot-post-sync-${userId}`, { ifAvailable: true }, async lock => {
      if (lock) await syncPostsWithinTab(userId, force)
    })
  } else {
    await syncPostsWithinTab(userId, force)
  }
}

export function useOfflineSync(userId: number) {
  const client = useQueryClient()
  useEffect(() => {
    activeUser = userId
    const sync = () => { if (document.visibilityState === 'visible') void synchronizeOfflinePosts(userId) }
    const published = () => { void client.invalidateQueries({ queryKey: ['feed'] }); void client.invalidateQueries({ queryKey: ['profile-posts'] }) }
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('relay-post-published', published)
    sync()
    return () => { stopOfflineSync(); window.removeEventListener('online', sync); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); window.removeEventListener('relay-post-published', published) }
  }, [userId, client])
}
