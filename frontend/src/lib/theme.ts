export const themes = ['light', 'dark', 'system'] as const;
export const THEME_STORAGE_KEY = 'toolhub-theme';

export type Theme = (typeof themes)[number];
export type ResolvedTheme = Exclude<Theme, 'system'>;

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && themes.includes(value as Theme);
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light';
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light';
}

export function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
  mediaQuery.addEventListener('change', onChange);

  return () => mediaQuery.removeEventListener('change', onChange);
}

export function resolveTheme(
  theme: Theme,
  systemTheme: ResolvedTheme,
): ResolvedTheme {
  return theme === 'system' ? systemTheme : theme;
}

export function applyTheme(resolvedTheme: ResolvedTheme): void {
  const root = document.documentElement;

  root.classList.toggle('light', resolvedTheme === 'light');
  root.classList.toggle('dark', resolvedTheme === 'dark');
  root.style.colorScheme = resolvedTheme;
}

export function readStoredTheme(
  storageKey: string,
  fallback: Theme,
): Theme {
  try {
    const storedTheme = localStorage.getItem(storageKey);
    return isTheme(storedTheme) ? storedTheme : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredTheme(storageKey: string, theme: Theme): void {
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // 存储不可用时仍保留当前标签页内的主题选择。
  }
}
