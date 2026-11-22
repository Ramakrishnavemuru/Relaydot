const test = require('node:test')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')
function compile(name) {
  const result = esbuild.buildSync({ entryPoints: [path.join(__dirname, `../src/${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const mod = new Module(path.join(__dirname, `${name}.bundle.cjs`))
  mod.filename = path.join(__dirname, `${name}.bundle.cjs`); mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}
global.window = new EventTarget()
global.localStorage = { removeItem() {} }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

test('concurrent mutations share one CSRF request, retaining protection', async () => {
  const { api } = compile('api')
  let csrf = 0, writes = 0
  global.fetch = async (url, options) => {
    if (url.endsWith('/auth/csrf')) { csrf++; return json({ csrf_token: 'bound-token' }) }
    assert.equal(options.headers.get('X-CSRF-Token'), 'bound-token')
    writes++; return json({ ok: true })
  }
  await Promise.all(Array.from({ length: 6 }, () => api('/messages', { method: 'POST', body: { content: 'test' } })))
  assert.equal(csrf, 1); assert.equal(writes, 6)
})

test('rotation recovers once only from an explicit pre-action CSRF rejection', async () => {
  const { api } = compile('api')
  let csrf = 0, writes = 0
  global.fetch = async url => url.endsWith('/auth/csrf') ? json({ csrf_token: `token-${++csrf}` }) :
    ++writes === 1 ? json({ detail: 'CSRF token missing or invalid' }, 403) : json({ ok: true })
  await api('/messages', { method: 'POST' })
  assert.equal(csrf, 2); assert.equal(writes, 2)
  global.fetch = async () => { writes++; throw new Error('Network interrupted') }
  await assert.rejects(api('/messages', { method: 'POST' }), /Network interrupted/)
  assert.equal(writes, 3, 'ambiguous writes must never automatically replay')
})

test('deadlines cover a hung CSRF request and a hung response body', async () => {
  const nativeTimeout = global.setTimeout
  global.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, Math.min(delay, 15), ...args)
  try {
    const { api } = compile('api')
    global.fetch = () => new Promise(() => {})
    await assert.rejects(api('/messages', { method: 'POST' }), /timed out/)
    global.fetch = async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) })
    await assert.rejects(api('/conversations'), /timed out/)
  } finally { global.setTimeout = nativeTimeout }
})

test('cancelled reads do not start fetch; expired sessions do not trigger refresh storms', async () => {
  const { api } = compile('api')
  let requests = 0, expired = 0
  global.fetch = async () => { requests++; return json({}, 401) }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(api('/messages', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(requests, 0)
  const onExpired = () => expired++
  window.addEventListener('relay-session-expired', onExpired)
  await assert.rejects(api('/conversations'), error => error.status === 401)
  assert.equal(requests, 1); assert.equal(expired, 1)
  window.removeEventListener('relay-session-expired', onExpired)
})

test('boot is deduplicated and network failures have a defined retryable state', async () => {
  let requests = 0, resolve
  global.fetch = () => { requests++; return new Promise(done => { resolve = done }) }
  const { useAuth } = compile('store')
  const first = useAuth.getState().boot(), second = useAuth.getState().boot()
  assert.equal(first, second); assert.equal(requests, 1)
  resolve(json({}, 503)); await first
  assert.equal(useAuth.getState().loading, false)
  assert.match(useAuth.getState().bootError, /connection/)
  global.fetch = async () => json({}, 401)
  await useAuth.getState().boot()
  assert.equal(useAuth.getState().user, null); assert.equal(useAuth.getState().bootError, null)
})

test('standalone startup failure renders a recovery action without the app bundle', () => {
  const events = {}, root = { children: [], replaceChildren() { this.children = [] }, append(node) { this.children.push(node) } }
  const context = { window: { addEventListener(name, handler) { events[name] = handler } },
    document: { documentElement: { dataset: {} }, getElementById() { return root }, createElement(tag) { return { tag, children: [], append(...nodes) { this.children.push(...nodes) } } } },
    location: { pathname: '/app/chats', search: '', hash: '' }, HTMLScriptElement: class {}, setTimeout(callback) { this.timeout = callback } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/startup.js'), 'utf8'), context)
  events['vite:preloadError']({ preventDefault() {} })
  assert.equal(root.children[0].children[0].textContent, 'Relaydot could not finish loading')
  assert.equal(root.children[0].children[2].href, '/app/chats')
  events['vite:preloadError']({ preventDefault() {} })
  assert.equal(root.children.length, 1)
})

test('blocked preference storage cannot prevent calls or settings from initializing', () => {
  const original = global.localStorage
  global.localStorage = { getItem() { throw new DOMException('Blocked', 'SecurityError') }, setItem() { throw new DOMException('Blocked', 'SecurityError') } }
  try {
    const { readPreference, writePreference } = compile('storage')
    assert.equal(readPreference('relay-mic-device'), '')
    assert.doesNotThrow(() => writePreference('relay-mic-device', 'test-device'))
  } finally { global.localStorage = original }
})

test('a missing lazy chunk never replaces DOM already owned by React', () => {
  let handler, rootReplaced = false, overlay
  const root = { replaceChildren() { rootReplaced = true } }
  const context = { window: { addEventListener(name, callback) { if (name === 'vite:preloadError') handler = callback } },
    document: { documentElement: { dataset: { reactMounted: 'true', appReady: 'true' } }, getElementById() { return root },
      body: { append(node) { overlay = node } }, createElement() { return { append() {}, setAttribute() {} } } },
    location: { pathname: '/app/settings', search: '', hash: '' }, HTMLScriptElement: class {}, setTimeout() {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/startup.js'), 'utf8'), context)
  handler({ preventDefault() {} })
  assert.equal(rootReplaced, false)
  assert.match(overlay.className, /startup-overlay/)
})
