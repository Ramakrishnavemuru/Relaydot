// Preferences are optional: blocked browser storage must never prevent rendering.
export function readPreference(key: string): string {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}
export function writePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* Apply in memory for this visit. */ }
}
