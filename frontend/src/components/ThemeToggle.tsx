import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/context/ThemeContext'
import type { Theme } from '@/context/ThemeContext'
import { isTheme } from '@/lib/theme'

const themeOptions = [
  { value: 'light', label: '明亮', icon: Sun },
  { value: 'dark', label: '暗黑', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
] satisfies ReadonlyArray<{
  value: Theme
  label: string
  icon: typeof Sun
}>

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const ResolvedThemeIcon = resolvedTheme === 'dark' ? Moon : Sun
  const resolvedThemeLabel = resolvedTheme === 'dark' ? '暗黑' : '明亮'
  const label =
    theme === 'system'
      ? `选择界面主题，当前跟随系统（${resolvedThemeLabel}）`
      : `选择界面主题，当前为${resolvedThemeLabel}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title={label} aria-label={label}>
          <ResolvedThemeIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>界面主题</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) {
              setTheme(value)
            }
          }}
        >
          {themeOptions.map((option) => {
            const OptionIcon = option.icon
            return (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <OptionIcon />
                {option.label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
