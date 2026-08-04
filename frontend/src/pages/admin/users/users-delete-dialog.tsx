import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useAdminApi } from '../hooks/use-admin-api'
import { adminUsersQueryKey } from './query-keys'
import { type User } from './schema'

/** 删除用户：需输入用户名确认（与 shadcn-admin 模板一致的防误删模式）。 */
export function UsersDeleteDialog({
  currentRow,
  open,
  onOpenChange,
}: {
  currentRow: User
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const api = useAdminApi()
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleDelete = async () => {
    if (value.trim() !== currentRow.username || submitting) return
    setSubmitting(true)
    try {
      await api.deleteUser(currentRow.id)
      toast.success(`已删除用户 ${currentRow.username}`)
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
    } catch (err) {
      console.error('删除用户失败', err)
      toast.error('删除失败')
    } finally {
      setSubmitting(false)
      setValue('')
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setValue('')
        onOpenChange(next)
      }}
      form='users-delete-form'
      destructive
      disabled={value.trim() !== currentRow.username || submitting}
      title={
        <span className='text-destructive'>
          <AlertTriangle
            className='me-1 inline-block stroke-destructive'
            size={18}
          />{' '}
          删除用户
        </span>
      }
      desc={
        <form
          id='users-delete-form'
          onSubmit={(e) => {
            e.preventDefault()
            void handleDelete()
          }}
          className='space-y-4'
        >
          <p className='mb-2'>
            确定要删除用户{' '}
            <span className='font-bold'>{currentRow.username}</span> 吗？
            <br />
            此操作将永久移除该账号及其所有关联数据，无法撤销。
          </p>

          <Label className='my-2 space-y-1.5'>
            <span className='text-[11px] font-mono uppercase tracking-widest text-muted-foreground'>
              用户名（输入以确认）
            </span>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder='输入用户名以确认删除'
              autoFocus
            />
          </Label>

          <Alert variant='destructive' className='rounded-none'>
            <AlertTitle>警告</AlertTitle>
            <AlertDescription>此操作不可回滚，请谨慎操作。</AlertDescription>
          </Alert>
        </form>
      }
      confirmText='删除'
      cancelBtnText='取消'
    />
  )
}
