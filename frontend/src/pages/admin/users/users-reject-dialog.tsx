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

/** 拒绝注册：确认弹窗，可填原因（仅写入审计，不参与业务逻辑）。 */
export function UsersRejectDialog({
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
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleReject = async () => {
    setSubmitting(true)
    try {
      await api.rejectUser(currentRow.id, reason.trim() || undefined)
      toast.success(`已拒绝 ${currentRow.username} 的注册申请`)
      setReason('')
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
    } catch (err) {
      console.error('拒绝注册失败', err)
      toast.error('拒绝失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      isLoading={submitting}
      handleConfirm={() => void handleReject()}
      title={
        <span className='text-destructive'>
          <AlertTriangle
            className='me-1 inline-block stroke-destructive'
            size={18}
          />{' '}
          拒绝注册
        </span>
      }
      desc={
        <div className='flex flex-col gap-4'>
          <p>
            确定要拒绝用户{' '}
            <span className='font-medium'>{currentRow.username}</span>{' '}
            的注册申请吗？该用户将无法登录系统。
          </p>
          <div className='flex flex-col gap-1.5'>
            <Label className='text-sm text-muted-foreground'>
              拒绝原因（可选，仅审计）
            </Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='例如：注册信息不完整'
              autoFocus
            />
          </div>
          <Alert variant='destructive'>
            <AlertTitle>注意</AlertTitle>
            <AlertDescription>
              被拒绝用户可在登录页看到对应的拒绝提示。
            </AlertDescription>
          </Alert>
        </div>
      }
      confirmText='确认拒绝'
      cancelBtnText='取消'
    />
  )
}
