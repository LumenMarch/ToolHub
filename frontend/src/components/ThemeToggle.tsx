import { Moon, Sun } from '@phosphor-icons/react';
import { useTheme } from './ThemeProvider';
interface ThemeToggleProps {
  // "default" 主站大尺寸带边框；"ghost" admin 状态栏无框紧凑样式。
  variant?: 'default' | 'ghost';
}

export function ThemeToggle({ variant = 'default' }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  const label = `切换主题，当前为${isDark ? '暗黑模式' : '明亮模式'}`;

  if (variant === 'ghost') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className="group relative inline-flex h-9 items-center justify-center overflow-hidden px-1 text-muted-foreground transition-colors hover:text-primary active:translate-y-px"
        title={label}
        aria-label={label}
      >
        {isDark ? (
          <Moon weight="fill" className="size-4 relative z-10" />
        ) : (
          <Sun weight="fill" className="size-4 relative z-10" />
        )}
        <div className="absolute bottom-0 left-0 w-full h-[1px] bg-primary -translate-x-[101%] group-hover:translate-x-0 transition-transform duration-500 ease-out" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-[background-color,color,transform] duration-300 hover:bg-muted hover:text-foreground active:translate-y-px"
      title={label}
      aria-label={label}
    >
      {isDark ? (
        <Moon weight="fill" className="size-4" />
      ) : (
        <Sun weight="fill" className="size-4" />
      )}
    </button>
  );
}
