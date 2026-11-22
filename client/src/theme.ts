import { create } from 'zustand'

export type ThemePreference = 'system' | 'light' | 'dark'

const storageKey = 'relay-theme'
const appearance = window.matchMedia('(prefers-color-scheme: dark)')

function savedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'light'
  } catch {
    return 'light'
  }
}

function applyTheme(preference: ThemePreference) {
  const theme = preference === 'system'
    ? (appearance.matches ? 'dark' : 'light')
    : preference
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#101626')
}

type ThemeState = {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}

const initialPreference = savedPreference()
applyTheme(initialPreference)

export const useTheme = create<ThemeState>(set => ({
  preference: initialPreference,
  setPreference: preference => {
    try { localStorage.setItem(storageKey, preference) } catch { /* The choice still applies for this visit. */ }
    applyTheme(preference)
    set({ preference })
  },
}))

appearance.addEventListener('change', () => {
  if (useTheme.getState().preference === 'system') applyTheme('system')
})
