import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import { useTheme } from '../context/ThemeContext';
import type { Theme } from '../context/ThemeContext';
import { isTheme } from '../lib/theme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

const themeOptions = [
  { value: 'light', label: '明亮', icon: Sun },
  { value: 'dark', label: '暗黑', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Desktop },
] satisfies ReadonlyArray<{
  value: Theme;
  label: string;
  icon: typeof Sun;
}>;

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const ResolvedThemeIcon = resolvedTheme === 'dark' ? Moon : Sun;
  const resolvedThemeLabel = resolvedTheme === 'dark' ? '暗黑' : '明亮';
  const label =
    theme === 'system'
      ? `选择界面主题，当前跟随系统（${resolvedThemeLabel}）`
      : `选择界面主题，当前为${resolvedThemeLabel}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group relative inline-flex size-9 items-center justify-center overflow-hidden text-muted-foreground transition-colors hover:text-primary active:translate-y-px"
          title={label}
          aria-label={label}
        >
          <ResolvedThemeIcon
            weight="fill"
            aria-hidden="true"
            className="relative z-10 size-4"
          />
          <span className="absolute bottom-0 left-0 h-px w-full -translate-x-[101%] bg-primary transition-transform duration-500 ease-out group-hover:translate-x-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 rounded-none border border-border bg-popover p-1 font-mono shadow-lg"
      >
        <DropdownMenuLabel className="px-3 py-2 text-[11px] uppercase tracking-widest">
          界面主题
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) {
              setTheme(value);
            }
          }}
        >
          {themeOptions.map((option) => {
            const OptionIcon = option.icon;

            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="rounded-none px-3 py-2.5 pr-8 text-xs uppercase tracking-wider"
              >
                <OptionIcon aria-hidden="true" className="size-4" />
                {option.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
