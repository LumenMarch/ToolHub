import { useState } from 'react'
import { type Table } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useAdminApi } from '../hooks/use-admin-api'
import { adminUsersQueryKey } from './query-keys'
import { type User } from './schema'

type DataTableBulkActionsProps<TData> = {
  table: Table<TData>
}

/** 用户批量操作：批量通过审批 + 批量删除。 */
export function DataTableBulkActions<TData>({
  table,
}: DataTableBulkActionsProps<TData>) {
  const api = useAdminApi()
  const queryClient = useQueryClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  // 选中集合以 rowSelection 的稳定行 id 为准（跨页选择不丢）
  const selectedIds = Object.keys(table.getState().rowSelection).map(Number)
  // 当前页已知的非待审批行（审批动作跳过；跨页未加载的行按 id 直接提交）
  const nonPendingIds = new Set<number>()
  for (const row of table.getFilteredSelectedRowModel().rows) {
    const user = row.original as User
    if (user.status !== 'pending') nonPendingIds.add(user.id)
  }

  const handleBulkApprove = async () => {
    const targets = selectedIds.filter((id) => !nonPendingIds.has(id))
    if (targets.length === 0) {
      toast.info('所选用户中没有待审批项')
      return
    }
    setBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((id) => api.approveUser(id)),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      if (ok === targets.length) {
        toast.success(`已通过 ${ok} 个注册申请`)
      } else {
        toast.error(`部分通过成功：${ok}/${targets.length}`)
      }
    } finally {
      setBusy(false)
    }
    table.resetRowSelection()
    void queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
  }

  const handleBulkDelete = async () => {
    setBusy(true)
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => api.deleteUser(id)),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      if (ok === selectedIds.length) {
        toast.success(`已删除 ${ok} 个用户`)
      } else {
        toast.error(`部分删除成功：${ok}/${selectedIds.length}`)
      }
    } finally {
      setBusy(false)
    }
    setShowDeleteConfirm(false)
    table.resetRowSelection()
    void queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
  }

  return (
    <>
      <BulkActionsToolbar table={table} entityName='用户'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='outline'
              size='icon'
              className='size-8'
              onClick={() => void handleBulkApprove()}
              disabled={busy}
              aria-label='批量通过审批'
              title='批量通过审批（仅待审批）'
            >
              <CheckCircle2 />
              <span className='sr-only'>批量通过审批</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>批量通过审批</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='destructive'
              size='icon'
              className='size-8'
              onClick={() => setShowDeleteConfirm(true)}
              disabled={busy}
              aria-label='批量删除用户'
              title='批量删除用户'
            >
              <Trash2 />
              <span className='sr-only'>批量删除用户</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>批量删除用户</p>
          </TooltipContent>
        </Tooltip>
      </BulkActionsToolbar>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        destructive
        isLoading={busy}
        handleConfirm={() => void handleBulkDelete()}
        title={<span className='text-destructive'>批量删除用户</span>}
        desc={
          <p>
            确定要删除选中的{' '}
            <span className='font-bold'>{selectedIds.length}</span>{' '}
            个用户吗？此操作不可撤销。
          </p>
        }
        confirmText='批量删除'
        cancelBtnText='取消'
      />
    </>
  )
}
