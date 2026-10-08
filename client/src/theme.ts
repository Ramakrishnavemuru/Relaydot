import { create } from 'zustand'

export type ThemePreference = 'system' | 'light' | 'dark'

const storageKey = 'relay-theme'
const appearance = window.matchMedia('(prefers-color-scheme: dark)')

function savedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = preference === 'system'
    ? (appearance.matches ? 'dark' : 'light')
    : preference
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
