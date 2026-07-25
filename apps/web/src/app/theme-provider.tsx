import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  ThemeContext,
  type ResolvedTheme,
  type Theme,
} from "@/app/theme-context";

const STORAGE_KEY = "toolhub-theme";

function getStoredTheme(): Theme {
  const storedTheme = window.localStorage.getItem(STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
    ? storedTheme
    : "system";
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    theme === "system" ? getSystemTheme() : theme,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      const nextTheme = theme === "system" ? getSystemTheme() : theme;
      document.documentElement.classList.toggle("dark", nextTheme === "dark");
      document.documentElement.style.colorScheme = nextTheme;
      setResolvedTheme(nextTheme);
    }

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme(nextTheme: Theme) {
        window.localStorage.setItem(STORAGE_KEY, nextTheme);
        setThemeState(nextTheme);
      },
    }),
    [resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
