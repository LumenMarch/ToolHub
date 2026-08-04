import { SlidersHorizontal } from 'lucide-react'
import { type Table } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type DataTableViewOptionsProps<TData> = {
  table: Table<TData>
}

export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  // 单趟收集可隐藏列，并用 meta.title（中文）作为显示名
  const toggleableColumns: {
    id: string
    title: string
    checked: boolean
    onCheckedChange: (value: boolean) => void
  }[] = []
  for (const column of table.getAllColumns()) {
    if (typeof column.accessorFn === 'undefined' || !column.getCanHide()) {
      continue
    }
    toggleableColumns.push({
      id: column.id,
      title: column.columnDef.meta?.title ?? column.id,
      checked: column.getIsVisible(),
      onCheckedChange: (value) => column.toggleVisibility(!!value),
    })
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='ms-auto hidden h-8 lg:flex'
        >
          <SlidersHorizontal className='size-4' />
          显示列
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-37.5'>
        <DropdownMenuLabel>切换列</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {toggleableColumns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            className='capitalize'
            checked={column.checked}
            onCheckedChange={column.onCheckedChange}
          >
            {column.title}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
