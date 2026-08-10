import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ResolvedTheme, Theme } from '../context/ThemeContext';
import { ThemeProviderContext } from '../context/ThemeContext';
import {
  applyTheme,
  getSystemTheme,
  isTheme,
  readStoredTheme,
  resolveTheme,
  subscribeToSystemTheme,
  THEME_STORAGE_KEY,
  writeStoredTheme,
} from '../lib/theme';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = THEME_STORAGE_KEY,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => readStoredTheme(storageKey, defaultTheme),
  );
  const systemTheme = useSyncExternalStore<ResolvedTheme>(
    subscribeToSystemTheme,
    getSystemTheme,
    () => 'light',
  );
  const resolvedTheme = resolveTheme(theme, systemTheme);

  useLayoutEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey) {
        return;
      }

      setTheme(isTheme(event.newValue) ? event.newValue : defaultTheme);
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [defaultTheme, storageKey]);

  const updateTheme = useCallback(
    (nextTheme: Theme) => {
      writeStoredTheme(storageKey, nextTheme);
      setTheme(nextTheme);
    },
    [storageKey],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme: updateTheme }),
    [resolvedTheme, theme, updateTheme],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}
