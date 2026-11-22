import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ApiError } from './api'
import './styles.css'
import './design/materials.css'
import './design/liquid-glass.css'
import './theme'
import { installDiagnostics } from './diagnostics'
installDiagnostics()

const client = new QueryClient({ defaultOptions: {
  queries: { staleTime: 15_000, networkMode: 'always', refetchOnWindowFocus: true,
    retry: (failures, error) => navigator.onLine && failures < 1 && !(error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) },
  mutations: { networkMode: 'always', retry: false },
} })

document.documentElement.dataset.reactMounted = 'true'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
