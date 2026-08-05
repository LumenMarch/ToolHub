import { useContext } from 'react'
import { Ellipsis, CheckCircle, Trash2, UserPen, XCircle } from 'lucide-react'
import { type Row } from '@tanstack/react-table'
import { AuthContext } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import PermissionGuard from '@/components/guards/PermissionGuard'
import { type User } from './schema'
import { useUsers } from './users-provider'

type DataTableRowActionsProps = {
  row: Row<User>
}

export function DataTableRowActions({ row }: DataTableRowActionsProps) {
  const { setOpen, setCurrentRow } = useUsers()
  const { user: currentUser } = useContext(AuthContext)
  const target = row.original
  const isSelf = currentUser?.id === target.id

  const openFor = (dialog: 'approve' | 'reject' | 'edit' | 'delete') => {
    setCurrentRow(target)
    setOpen(dialog)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          className='flex h-8 w-8 p-0 data-[state=open]:bg-muted'
        >
          <Ellipsis className='h-4 w-4' />
          <span className='sr-only'>打开菜单</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-44'>
        {target.status === 'pending' ? (
          // 待审批行：仅审批操作
          <PermissionGuard permission='user:write'>
            <DropdownMenuItem onClick={() => openFor('approve')}>
              通过审批
              <DropdownMenuShortcut>
                <CheckCircle size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openFor('reject')}>
              拒绝
              <DropdownMenuShortcut>
                <XCircle size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </PermissionGuard>
        ) : target.status === 'rejected' ? (
          // 已拒绝行：可重新审批（复用 approve 弹窗，后端 approve 支持 rejected→approved）
          <PermissionGuard permission='user:write'>
            <DropdownMenuItem onClick={() => openFor('approve')}>
              重新审批
              <DropdownMenuShortcut>
                <CheckCircle size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openFor('edit')}>
              编辑
              <DropdownMenuShortcut>
                <UserPen size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => openFor('delete')}
              disabled={isSelf}
              title={isSelf ? '不能删除自己' : undefined}
              className='text-destructive!'
            >
              删除
              <DropdownMenuShortcut>
                <Trash2 size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </PermissionGuard>
        ) : (
          // 已批准行：编辑与删除
          <PermissionGuard permission='user:write'>
            <DropdownMenuItem onClick={() => openFor('edit')}>
              编辑
              <DropdownMenuShortcut>
                <UserPen size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => openFor('delete')}
              disabled={isSelf}
              title={isSelf ? '不能删除自己' : undefined}
              className='text-destructive!'
            >
              删除
              <DropdownMenuShortcut>
                <Trash2 size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </PermissionGuard>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
