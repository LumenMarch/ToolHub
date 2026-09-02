import { useMemo, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Option {
  value: string
  label: string
}

interface SearchableMultiSelectProps {
  values: string[]
  onValuesChange: (values: string[]) => void
  options: Option[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  ariaLabel?: string
  disabled?: boolean
}

export function SearchableMultiSelect({
  values,
  onValuesChange,
  options,
  placeholder = '全部',
  searchPlaceholder = '搜索...',
  emptyText = '无匹配结果',
  ariaLabel,
  disabled,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = useMemo(() => new Set(values), [values])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        option.value.toLowerCase().includes(query),
    )
  }, [options, search])

  const toggle = (value: string) => {
    if (selected.has(value)) {
      onValuesChange(values.filter((item) => item !== value))
      return
    }
    onValuesChange([...values, value])
  }

  const summary =
    values.length === 0
      ? placeholder
      : values.length === 1
        ? (options.find((option) => option.value === values[0])?.label ?? values[0])
        : `${values.length} 已选`

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          type="button"
          className={cn(
            'w-full justify-between font-normal',
            values.length === 0 && 'text-muted-foreground',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-left">{summary}</span>
            {values.length > 1 ? (
              <Badge variant="secondary">{values.length}</Badge>
            ) : null}
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandGroup>
              {filtered.map((option) => {
                const isSelected = selected.has(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    onSelect={() => toggle(option.value)}
                  >
                    <span className="truncate">{option.label}</span>
                    <CheckIcon
                      className={cn(
                        'ml-auto size-4 shrink-0',
                        isSelected ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {filtered.length === 0 ? <CommandEmpty>{emptyText}</CommandEmpty> : null}
            {values.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onValuesChange([])}>
                    清除筛选（全部）
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
