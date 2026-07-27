import { Moon, Sun } from '@phosphor-icons/react';
import { useTheme } from './ThemeProvider';
import { cn } from '../lib/cn';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // 解析当前实际显示的主题（如果选择的是 system，则根据系统偏好计算）
  const isDark = 
    theme === 'dark' || 
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const toggleTheme = () => {
    // 强制将其切换为明确的 light 或 dark
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-[background-color,color,transform] duration-300 hover:bg-muted hover:text-foreground active:translate-y-px"
      )}
      title={`切换主题 (当前: ${isDark ? '暗黑模式' : '明亮模式'})`}
      aria-label={`切换主题，当前为${isDark ? '暗黑模式' : '明亮模式'}`}
    >
      {isDark ? (
        <Moon weight="fill" className="size-4" />
      ) : (
        <Sun weight="fill" className="size-4" />
      )}
    </button>
  );
}
