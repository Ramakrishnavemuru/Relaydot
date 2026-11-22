import { Component, type ReactNode } from 'react'

export function LoadFailure({ message, retry }: { message: string; retry: () => void }) {
  return <main className="load-failure" role="alert"><h1>Unable to open this page</h1><p>{message}</p><button className="button primary" onClick={retry}>Try again</button><a href="/app/">Back to Relaydot</a></main>
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) {
    // Never log component props, request bodies, tokens or user content.
    if (import.meta.env.DEV) console.warn('Relaydot render failed:', error.name)
  }
  render() {
    return this.state.failed ? <LoadFailure message="A required part of the page could not load. Reload to get the latest version." retry={() => location.reload()} /> : this.props.children
  }
}
