import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAdminApi, type Role } from '../hooks/use-admin-api'
import { adminRolesQueryKey, adminUsersQueryKey } from './query-keys'
import { type User } from './schema'

const formSchema = z.object({
  roleIds: z.array(z.number()).min(1, '至少选择一个角色'),
})
type ApproveForm = z.infer<typeof formSchema>

/** 通过审批：角色多选（必填，默认勾选"工具使用者"）。 */
export function UsersApproveDialog({
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

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ApproveForm>({
    resolver: zodResolver(formSchema),
    defaultValues: { roleIds: [] },
  })

  const rolesQuery = useQuery({
    queryKey: adminRolesQueryKey,
    queryFn: () => api.listRoles(),
    staleTime: 60 * 1000,
  })

  // 默认勾选"工具使用者"：仅在每次打开后的首次数据就绪时写入一次
  const bootstrappedRef = useRef(false)

  // 打开弹窗时重置表单（仅 open 变化触发，数据 refetch 不会重置已选角色）
  useEffect(() => {
    if (!open) return
    bootstrappedRef.current = false
    reset({ roleIds: [] })
  }, [open, reset])

  useEffect(() => {
    if (!open || bootstrappedRef.current || !rolesQuery.data) return
    bootstrappedRef.current = true
    const defaultRole = rolesQuery.data.find((r) => r.name === '工具使用者')
    if (defaultRole) setValue('roleIds', [defaultRole.id])
  }, [open, rolesQuery.data, setValue])

  const allRoles = rolesQuery.data ?? ([] as Role[])

  const onSubmit = handleSubmit(async (values) => {
    try {
      await api.approveUser(currentRow.id, values.roleIds)
      toast.success(`已通过 ${currentRow.username} 的注册审批`)
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
    } catch {
      toast.error('审批通过失败')
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader className='text-start'>
          <DialogTitle>通过审批</DialogTitle>
          <DialogDescription>
            批准用户{' '}
            <span className='font-mono font-bold text-foreground'>
              {currentRow.username}
            </span>{' '}
            的注册申请，并为其分配初始角色。
          </DialogDescription>
        </DialogHeader>

        <form id='approve-user-form' onSubmit={onSubmit} className='space-y-4'>
          <Controller
            control={control}
            name='roleIds'
            render={({ field }) => (
              <div className='space-y-1.5'>
                <Label className='text-[11px] font-mono uppercase tracking-widest text-muted-foreground'>
                  分配角色（必选）
                </Label>
                {rolesQuery.isPending && (
                  <p className='text-xs text-muted-foreground'>
                    角色列表加载中...
                  </p>
                )}
                {rolesQuery.isError && (
                  <div className='flex items-center gap-2 text-xs text-destructive'>
                    <span>角色列表加载失败</span>
                    <Button
                      type='button'
                      variant='outline'
                      size='xs'
                      onClick={() => void rolesQuery.refetch()}
                    >
                      重试
                    </Button>
                  </div>
                )}
                {!rolesQuery.isPending &&
                  !rolesQuery.isError &&
                  allRoles.length === 0 && (
                    <p className='text-xs text-muted-foreground'>
                      暂无角色可选，请先在「角色管理」中创建角色。
                    </p>
                  )}
                {allRoles.map((role) => {
                  const checked = field.value.includes(role.id)
                  return (
                    <label
                      key={role.id}
                      className='flex cursor-pointer items-center gap-2 text-sm'
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => {
                          const next = value
                            ? [...field.value, role.id]
                            : field.value.filter((id) => id !== role.id)
                          field.onChange(next)
                        }}
                      />
                      <span className='font-mono'>{role.name}</span>
                      {role.name === '工具使用者' && (
                        <Badge
                          variant='secondary'
                          className='rounded-none px-1 text-[10px] font-mono uppercase tracking-widest'
                        >
                          默认
                        </Badge>
                      )}
                      <span className='ml-auto text-[11px] text-muted-foreground'>
                        {role.permission_count} 项权限
                      </span>
                    </label>
                  )
                })}
                {errors.roleIds && (
                  <p className='text-[11px] font-mono uppercase tracking-widest text-destructive'>
                    [ {errors.roleIds.message} ]
                  </p>
                )}
              </div>
            )}
          />
        </form>

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type='submit' form='approve-user-form' disabled={isSubmitting}>
            {isSubmitting ? '提交中...' : '确认通过'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
