import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ThemeModeContext } from './theme-context'
import type { ResolvedTheme, ThemeMode, ThemeModeContextValue } from './theme-context'

const STORAGE_KEY = 'toolhub-theme'

function readInitialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage 不可用时回落到系统主题
  }
  return 'system'
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readInitialMode)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  )

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  const resolved: ResolvedTheme =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolved
    root.style.colorScheme = resolved
    root.classList.toggle('light', resolved === 'light')
    root.classList.toggle('dark', resolved === 'dark')
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // 忽略持久化失败
    }
  }, [mode, resolved])

  const value = useMemo<ThemeModeContextValue>(
    () => ({
      mode,
      resolved,
      setMode: setModeState,
      toggle: () => setModeState(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [mode, resolved],
  )

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>
}
