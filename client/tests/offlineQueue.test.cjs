const test = require('node:test')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/offlineQueue.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' }).outputFiles[0].text
const compiled = new Module(path.join(__dirname, 'offlineQueue.bundle.cjs'))
compiled.filename = path.join(__dirname, 'offlineQueue.bundle.cjs')
compiled.paths = module.paths
compiled._compile(code, compiled.filename)
const queue = compiled.exports

class FakeDatabase {
  constructor() { this.rows = new Map(); this.objectStoreNames = { contains: () => this.ready } }
  createObjectStore() { this.ready = true; return { createIndex() {} } }
  close() {}
  transaction() {
    const tx = { oncomplete: null, onerror: null, onabort: null }
    const run = callback => {
      const request = { result: undefined, error: null, onsuccess: null, onerror: null }
      queueMicrotask(() => {
        if (this.quota) {
          request.error = new DOMException('Storage is full', 'QuotaExceededError')
          request.onerror?.()
          tx.onabort?.()
          return
        }
        request.result = callback()
        request.onsuccess?.()
        tx.oncomplete?.()
      })
      return request
    }
    tx.objectStore = () => ({
      put: post => run(() => { this.rows.set(post.id, structuredClone(post)); return post.id }),
      delete: id => run(() => { this.rows.delete(id) }),
      index: () => ({ getAll: userId => run(() => [...this.rows.values()].filter(row => row.userId === userId)) }),
    })
    return tx
  }
}

const database = new FakeDatabase()
global.indexedDB = { open() {
  const request = { result: database, error: null, onupgradeneeded: null, onsuccess: null, onerror: null }
  queueMicrotask(() => { if (!database.ready) request.onupgradeneeded?.(); request.onsuccess?.() })
  return request
} }
global.window = new EventTarget()
global.window.indexedDB = global.indexedDB
global.document = { documentElement: { dataset: { mediaQuality: 'original' } } }
global.localStorage = { removeItem() {} }
Object.defineProperty(global, 'navigator', { configurable: true, value: { onLine: true } })

const item = (id, userId = 1, overrides = {}) => ({ id, userId, content: 'Offline text',
  collaboratorIds: [], createdAt: Date.now(), status: 'Queued', attempts: 0, nextAttemptAt: 0, ...overrides })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('stores, edits, isolates, restores, and deletes queued posts', async () => {
  database.rows.clear()
  const original = item('11111111-1111-4111-8111-111111111111', 1, { status: 'Draft' })
  await queue.saveQueuedPost(original)
  await queue.saveQueuedPost(item('22222222-2222-4222-8222-222222222222', 2))
  assert.equal((await queue.queuedPosts(1))[0].status, 'Draft')
  assert.equal((await queue.queuedPosts(2)).length, 1)
  await queue.saveQueuedPost({ ...original, content: 'Edited offline' })
  assert.equal((await queue.queuedPosts(1))[0].content, 'Edited offline')
  await queue.deleteQueuedPost(original.id, 1)
  assert.equal((await queue.queuedPosts(1)).length, 0)
  assert.equal((await queue.queuedPosts(2)).length, 1)
})

test('reconnect publishes text and media once with the same client ID', async () => {
  database.rows.clear()
  const textId = '33333333-3333-4333-8333-333333333333'
  const mediaId = '44444444-4444-4444-8444-444444444444'
  await queue.saveQueuedPost(item(textId))
  await queue.saveQueuedPost(item(mediaId, 1, { file: new File(['png data'], 'pic.png', { type: 'image/png' }), mediaType: 'IMAGE', collaboratorIds: [2] }))
  const calls = []
  global.fetch = async (url, options) => {
    if (url.endsWith('/auth/csrf')) return json({ csrf_token: 'test-csrf' })
    if (url.includes('/notifications')) return json({ items: [] })
    if (url.endsWith('/social/post-media')) return json({ file_url: '/api/social/post-media/0123456789abcdef0123456789abcdef' })
    if (url.endsWith('/posts')) { const body = JSON.parse(options.body); calls.push(body); return json({ id: calls.length, ...body }, 201) }
    throw new Error(`Unexpected URL: ${url}`)
  }
  await queue.synchronizeOfflinePosts(1)
  const rows = await queue.queuedPosts(1)
  assert.deepEqual(rows.map(row => row.status), ['Published', 'Published'])
  assert.equal(calls.length, 2)
  assert.equal(calls.find(call => call.client_id === mediaId).media_url, '/api/social/post-media/0123456789abcdef0123456789abcdef')
  assert.deepEqual(calls.find(call => call.client_id === mediaId).collaborator_ids, [2])
  await queue.synchronizeOfflinePosts(1)
  assert.equal(calls.length, 2)
  queue.stopOfflineSync()
})

test('failed uploads remain queued, can retry, and report expired sessions', async () => {
  database.rows.clear()
  const id = '55555555-5555-4555-8555-555555555555'
  await queue.saveQueuedPost(item(id))
  let fail = true
  global.fetch = async url => {
    if (url.endsWith('/auth/csrf')) return json({ csrf_token: 'test-csrf' })
    if (url.includes('/notifications')) return json({ items: [] })
    if (url.endsWith('/posts')) { if (fail) throw new Error('Connection interrupted'); return json({ id: 9 }, 201) }
    throw new Error('Unexpected URL')
  }
  await queue.synchronizeOfflinePosts(1)
  assert.equal((await queue.queuedPosts(1))[0].status, 'Failed')
  assert.equal((await queue.queuedPosts(1))[0].attempts, 1)
  fail = false
  await queue.synchronizeOfflinePosts(1, true)
  assert.equal((await queue.queuedPosts(1))[0].status, 'Published')
  queue.stopOfflineSync()

  await queue.saveQueuedPost(item('66666666-6666-4666-8666-666666666666'))
  global.fetch = async url => url.endsWith('/auth/refresh') ? json({}, 401) :
    url.includes('/notifications') ? json({ items: [] }) : json({}, 401)
  await queue.synchronizeOfflinePosts(1)
  assert.equal((await queue.queuedPosts(1)).find(row => row.id.startsWith('6666')).status, 'Action Required')
  queue.stopOfflineSync()
})

test('storage quota failure produces an actionable error', async () => {
  database.quota = true
  await assert.rejects(queue.saveQueuedPost(item('77777777-7777-4777-8777-777777777777')), /no room/)
  database.quota = false
})
