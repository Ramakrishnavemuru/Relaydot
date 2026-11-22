// Local development only. Values never include URLs, user data or error messages.
export function installDiagnostics() {
  if (!import.meta.env.DEV || typeof PerformanceObserver === 'undefined') return
  performance.mark('relay-bootstrap')
  const observers: PerformanceObserver[] = []
  for (const type of ['longtask', 'layout-shift', 'largest-contentful-paint']) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        console.debug('[Relay performance]', entry.entryType, Math.round(entry.startTime), Math.round(entry.duration))
      }
    })
    observer.observe({ type, buffered: true })
    observers.push(observer)
  }
  const dispose = () => observers.forEach(observer => observer.disconnect())
  window.addEventListener('pagehide', dispose, { once: true })
  if (import.meta.hot) import.meta.hot.dispose(() => { dispose(); window.removeEventListener('pagehide', dispose) })
}
