import { type ColumnDef } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTableColumnHeader } from '@/components/data-table'
import { callTypes, formatAdminDate } from './data'
import { type User } from './schema'
import { DataTableRowActions } from './data-table-row-actions'
import { DataTableStatusCell } from './data-table-status-cell'

/** 状态列展示：审批状态优先，已批准但停用的展示「已停用」，与「已拒绝」区分。 */
function resolveStatusDisplay(user: User): { label: string; className: string } {
  if (user.status === 'pending' || user.status === 'rejected') {
    return callTypes[user.status]
  }
  if (!user.is_active) {
    return {
      label: '已停用',
      className: 'border-border bg-muted text-muted-foreground',
    }
  }
  return callTypes.approved
}

export const usersColumns: ColumnDef<User>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label='全选'
        className='translate-y-0.5'
      />
    ),
    meta: {
      className: cn('inset-s-0 z-10 max-md:sticky'),
    },
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label='选择该行'
        className='translate-y-0.5'
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'username',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='用户名' />
    ),
    cell: ({ row }) => (
      <span className='ps-3 font-mono'>{row.getValue('username')}</span>
    ),
    meta: {
      title: '用户名',
      className: cn('inset-s-6 ps-0.5 max-md:sticky'),
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: 'roles',
    accessorFn: (row) => row.roles.join(','),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='角色' />
    ),
    cell: ({ row }) => {
      const roles = row.original.roles
      return roles.length > 0 ? (
        <div className='flex flex-wrap gap-1'>
          {roles.map((role) => (
            <span
              key={role}
              className='inline-flex items-center border border-border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground'
            >
              {role}
            </span>
          ))}
        </div>
      ) : (
        <span className='text-[11px] font-mono text-muted-foreground'>—</span>
      )
    },
    meta: { title: '角色' },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='审批状态' />
    ),
    cell: ({ row }) => {
      const display = resolveStatusDisplay(row.original)
      return (
        <div className='flex space-x-2'>
          <Badge variant='outline' className={cn(display.className)}>
            {display.label}
          </Badge>
        </div>
      )
    },
    meta: { title: '审批状态' },
    enableHiding: false,
    enableSorting: false,
  },
  {
    accessorKey: 'created_at',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='创建时间' />
    ),
    cell: ({ row }) => (
      <span className='text-[11px] font-mono text-muted-foreground'>
        {formatAdminDate(row.getValue('created_at'))}
      </span>
    ),
    meta: { title: '创建时间' },
    enableSorting: false,
  },
  {
    accessorKey: 'last_login_at',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='状态' />
    ),
    // 可点击状态单元格：在线 → 绿点+「在线」；离线 → 「上次登录 {时间}」；点击打开会话弹窗
    cell: ({ row }) => <DataTableStatusCell user={row.original} />,
    meta: { title: '状态', className: 'w-44' },
    enableSorting: false,
  },
  {
    id: 'actions',
    cell: DataTableRowActions,
    enableSorting: false,
    enableHiding: false,
  },
]
