import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'hajj-admin-theme'

export type AdminTheme = 'light' | 'dark'

function readStoredTheme(): AdminTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // Private browsing / disabled storage — fall back to light.
  }
  return 'light'
}

/**
 * The admin console's own light/dark preference.
 *
 * `.dark` is applied to `<html>` (not a wrapper inside the console) because
 * shadcn/Radix pieces — dialogs, dropdowns, popovers, the toaster — render
 * through a portal to `document.body`, outside any element this component
 * tree controls; a class scoped to a console wrapper would never reach them.
 * The class is removed on unmount instead, which is what keeps the citizen
 * portal — which never mounts this hook — always light.
 */
export function useAdminTheme() {
  const [theme, setTheme] = useState<AdminTheme>(readStoredTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Nothing to persist to; the toggle still works for this visit.
    }
    return () => {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggle }
}
