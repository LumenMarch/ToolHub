import { useEffect, useState } from 'react'
import {
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTablePagination, DataTableToolbar } from '@/components/data-table'
import { useAdminApi } from '../hooks/use-admin-api'
import { adminUsersQueryKey } from './query-keys'
import { DataTableBulkActions } from './data-table-bulk-actions'
import { usersColumns as columns } from './users-columns'
import { statusOptions } from './data'

/** 用户表格：服务端分页 + 搜索/状态筛选进 URL（use-table-url-state）。 */
export function UsersTable() {
  const api = useAdminApi()

  // 本地 UI 状态（仅当前会话）
  const [rowSelection, setRowSelection] = useState({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  // 筛选/分页与 URL 同步
  const {
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    pagination: { defaultPage: 1, defaultPageSize: 10 },
    globalFilter: { enabled: false },
    columnFilters: [
      // 用户名按列文本筛选
      { columnId: 'username', searchKey: 'username', type: 'string' },
      // 状态多值筛选（URL 序列化为重复参数 status=a&status=b）
      { columnId: 'status', searchKey: 'status', type: 'array' },
    ],
  })

  // 单一数据源：请求参数直接消费 columnFilters（与工具栏 UI 同源），
  // 避免与 URL 派生值在外部变更时漂移。
  const usernameFilter = columnFilters.find((f) => f.id === 'username')
  const statusFilter = columnFilters.find((f) => f.id === 'status')
  const username =
    typeof usernameFilter?.value === 'string' ? usernameFilter.value : ''
  const statuses = Array.isArray(statusFilter?.value)
    ? (statusFilter.value as string[])
    : []
  const page = pagination.pageIndex + 1
  const pageSize = pagination.pageSize

  // 搜索防抖：停顿 350ms 后才触发服务端查询
  const [debouncedUsername, setDebouncedUsername] = useState(username)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedUsername(username), 350)
    return () => window.clearTimeout(timer)
  }, [username])

  const usersQuery = useQuery({
    queryKey: [
      ...adminUsersQueryKey,
      { search: debouncedUsername, status: statuses, page, pageSize },
    ],
    queryFn: () =>
      api.listUsers({
        search: debouncedUsername.trim() || undefined,
        status: statuses,
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }),
    placeholderData: keepPreviousData,
  })

  const data = usersQuery.data?.items ?? []
  const total = usersQuery.data?.total ?? 0

  const table = useReactTable({
    data,
    columns,
    state: {
      pagination,
      rowSelection,
      columnFilters,
      columnVisibility,
    },
    rowCount: total,
    enableRowSelection: true,
    manualPagination: true,
    // 行 id 用后端稳定主键：跨页选择/排序变化后选中不漂移
    getRowId: (row) => String(row.id),
    onPaginationChange,
    onColumnFiltersChange,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  })

  // 服务端返回后页码越界自动回退
  useEffect(() => {
    ensurePageInRange(table.getPageCount())
  }, [table, ensurePageInRange])

  const visibleLeafColumns = table.getVisibleLeafColumns()

  return (
    // @container/content：让分页组件的容器查询断点（@max-2xl/content 等）生效
    <div className='@container/content flex flex-1 flex-col gap-4'>
      <DataTableToolbar
        table={table}
        searchPlaceholder='筛选用户名...'
        searchKey='username'
        filters={[
          {
            columnId: 'status',
            title: '审批状态',
            options: statusOptions,
          },
        ]}
      />

      <div className='overflow-hidden rounded-xl border border-border'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className='group/row'>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cn(
                      'bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted',
                      header.column.columnDef.meta?.className,
                      header.column.columnDef.meta?.thClassName
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {usersQuery.isPending ? (
              <TableRow>
                {visibleLeafColumns.map((column) => (
                  <TableCell key={column.id}>
                    <Skeleton className='h-6 w-full' />
                  </TableCell>
                ))}
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className='group/row'
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted',
                        cell.column.columnDef.meta?.className,
                        cell.column.columnDef.meta?.tdClassName
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={visibleLeafColumns.length}
                  className='h-24 text-center'
                >
                  {usersQuery.isError ? (
                    <div className='flex flex-col items-center gap-3'>
                      <span className='text-sm text-muted-foreground'>
                        加载用户列表失败
                      </span>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => void usersQuery.refetch()}
                      >
                        重试
                      </Button>
                    </div>
                  ) : (
                    <span className='text-sm text-muted-foreground'>
                      无匹配用户
                    </span>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} className='mt-auto' />
      <DataTableBulkActions table={table} />
    </div>
  )
}
