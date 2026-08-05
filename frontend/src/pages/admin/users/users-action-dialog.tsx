import { useEffect, useMemo } from 'react'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAdminApi, type Role, type UserCreateInput } from '../hooks/use-admin-api'
import { adminRolesQueryKey, adminUsersQueryKey } from './query-keys'
import { type User } from './schema'

type UserForm = z.infer<ReturnType<typeof buildFormSchema>>

/** 校验规则：新建必须填密码（trim 后至少 6 位）且至少一个角色；
 *  编辑时密码留空表示不修改，角色可为空（允许管理员清空角色）。 */
function buildFormSchema(isEdit: boolean) {
  return z
    .object({
      username: z.string().min(1, '用户名不能为空'),
      password: z.string(),
      roleIds: z.array(z.number()),
      isActive: z.boolean(),
    })
    .superRefine((data, ctx) => {
      const password = data.password.trim()
      if (isEdit) {
        // 编辑：留空 = 不修改；填写则至少 6 位
        if (password !== '' && password.length < 6) {
          ctx.addIssue({
            code: 'custom',
            path: ['password'],
            message: '新密码至少 6 位',
          })
        }
      } else if (password.length < 6) {
        ctx.addIssue({
          code: 'custom',
          path: ['password'],
          message: '密码至少 6 位',
        })
      }
      if (!isEdit && data.roleIds.length < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['roleIds'],
          message: '至少选择一个角色',
        })
      }
    })
}

/** 新建 / 编辑用户弹窗：用户名 + 密码（编辑时留空不修改）+ 角色多选 + 启用状态。 */
export function UsersActionDialog({
  currentRow,
  open,
  onOpenChange,
  isSelf = false,
}: {
  currentRow?: User
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 是否正在编辑自己（不可改角色 / 停用自己） */
  isSelf?: boolean
}) {
  const api = useAdminApi()
  const queryClient = useQueryClient()
  const isEdit = !!currentRow

  const formSchema = useMemo(() => buildFormSchema(isEdit), [isEdit])

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UserForm>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', password: '', roleIds: [], isActive: true },
  })

  const rolesQuery = useQuery({
    queryKey: adminRolesQueryKey,
    queryFn: () => api.listRoles(),
    staleTime: 60 * 1000,
    enabled: open,
  })

  // 打开时初始化表单；getUserRoles 用取消标记防迟到响应覆盖新行
  useEffect(() => {
    if (!open) return
    if (currentRow) {
      reset({
        username: currentRow.username,
        password: '',
        roleIds: [],
        isActive: currentRow.is_active,
      })
      if (!isSelf) {
        let cancelled = false
        api
          .getUserRoles(currentRow.id)
          .then((roles) => {
            if (!cancelled) setValue('roleIds', roles.map((r) => r.id))
          })
          .catch(() => toast.error('用户角色加载失败'))
        return () => {
          cancelled = true
        }
      }
    } else {
      reset({ username: '', password: '', roleIds: [], isActive: true })
    }
  }, [open, currentRow, isSelf, api, reset, setValue])

  const allRoles = rolesQuery.data ?? ([] as Role[])

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && currentRow) {
        await api.updateUser(currentRow.id, {
          is_active: values.isActive,
          role_ids: isSelf ? undefined : values.roleIds,
          password: values.password.trim() || undefined,
        })
        toast.success(`已更新用户 ${currentRow.username}`)
      } else {
        const input: UserCreateInput = {
          username: values.username.trim(),
          password: values.password.trim(),
          role_ids: values.roleIds,
        }
        await api.createUser(input)
        toast.success(`已创建用户 ${input.username}`)
      }
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
    } catch {
      toast.error(isEdit ? '保存失败' : '创建失败，用户名可能已存在')
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader className='text-start'>
          <DialogTitle>{isEdit ? '编辑用户' : '新建用户'}</DialogTitle>
          <DialogDescription>
            {isEdit ? '更新用户信息，保存后生效。' : '创建系统账号并分配角色。'}
          </DialogDescription>
        </DialogHeader>

        <form id='user-form' onSubmit={onSubmit} className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='user-username' className='text-[11px] font-mono uppercase tracking-widest text-muted-foreground'>
              用户名
            </Label>
            <Input
              id='user-username'
              placeholder='用户名'
              autoComplete='off'
              disabled={isEdit}
              {...register('username')}
            />
            {errors.username && (
              <p className='text-[11px] font-mono uppercase tracking-widest text-destructive'>
                [ {errors.username.message} ]
              </p>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='user-password' className='text-[11px] font-mono uppercase tracking-widest text-muted-foreground'>
              密码{isEdit ? '（留空则不修改）' : ''}
            </Label>
            <Input
              id='user-password'
              type='password'
              placeholder={isEdit ? '输入新密码以重置' : '密码（至少 6 位）'}
              autoComplete='new-password'
              {...register('password')}
            />
            {errors.password && (
              <p className='text-[11px] font-mono uppercase tracking-widest text-destructive'>
                [ {errors.password.message} ]
              </p>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label className='text-[11px] font-mono uppercase tracking-widest text-muted-foreground'>
              角色{isSelf && '（不能修改自己的角色）'}
              {!isEdit && '（必选）'}
            </Label>
            {allRoles.length === 0 && !rolesQuery.isPending && (
              <p className='text-xs text-muted-foreground'>
                角色列表加载中或为空...
              </p>
            )}
            <Controller
              control={control}
              name='roleIds'
              render={({ field }) => (
                <div className='space-y-1.5'>
                  {allRoles.map((role) => {
                    const checked = field.value.includes(role.id)
                    return (
                      <label
                        key={role.id}
                        className={`flex cursor-pointer items-center gap-2 text-sm ${
                          isSelf ? 'cursor-not-allowed opacity-60' : ''
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={isSelf}
                          onCheckedChange={(value) => {
                            const next = value
                              ? [...field.value, role.id]
                              : field.value.filter((id) => id !== role.id)
                            field.onChange(next)
                          }}
                        />
                        <span className='font-mono'>{role.name}</span>
                        <span className='ml-auto text-[11px] text-muted-foreground'>
                          {role.permission_count} 项权限
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            />
            {errors.roleIds && (
              <p className='text-[11px] font-mono uppercase tracking-widest text-destructive'>
                [ {errors.roleIds.message} ]
              </p>
            )}
          </div>

          {isEdit && (
            <Controller
              control={control}
              name='isActive'
              render={({ field }) => (
                <label
                  className={`flex cursor-pointer items-center justify-between ${
                    isSelf ? 'cursor-not-allowed opacity-60' : ''
                  }`}
                >
                  <span className='text-sm font-mono uppercase tracking-widest'>
                    账号启用
                  </span>
                  <Checkbox
                    checked={field.value}
                    disabled={isSelf}
                    onCheckedChange={(value) => field.onChange(!!value)}
                  />
                </label>
              )}
            />
          )}
          {isEdit && isSelf && (
            <p className='text-[10px] font-mono uppercase tracking-widest text-muted-foreground opacity-60'>
              不能停用自己的账号
            </p>
          )}
        </form>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type='submit' form='user-form' disabled={isSubmitting}>
            {isSubmitting ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
