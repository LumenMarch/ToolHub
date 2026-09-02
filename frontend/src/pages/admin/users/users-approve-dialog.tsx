import { useMemo, useState } from 'react'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
import { adminPermissionsQueryKey, adminRolesQueryKey, adminUsersQueryKey } from './query-keys'
import { type User } from './schema'

// 角色可为空数组：角色区只显示自定义角色（"工具使用者"由工具权限二选一表达），
// 空数组语义 = 不分配角色（'all' 模式提交时省略 role_ids，由后端默认分配"工具使用者"）。
const formSchema = z.object({
  roleIds: z.array(z.number()),
})
type ApproveForm = z.infer<typeof formSchema>

/** 通过审批：角色多选（可选，默认空）+ 工具权限二选一（默认"工具使用者"全部工具）。 */
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

  const permissionsQuery = useQuery({
    queryKey: adminPermissionsQueryKey,
    queryFn: () => api.listPermissions(),
    staleTime: 60 * 1000,
  })

  // 工具权限二选一：'all' = 工具使用者（全部工具），'custom' = 自定义逐个勾选
  const [toolMode, setToolMode] = useState<'all' | 'custom'>('all')
  // 自定义模式下勾选的工具权限 id
  const [toolIds, setToolIds] = useState<number[]>([])

  // 全部 tool: 前缀权限：'all' 模式的全选集合
  const allPermissions = useMemo(() => permissionsQuery.data ?? [], [permissionsQuery.data])
  const allToolPerms = useMemo(
    () =>
      allPermissions
        .filter((perm) => perm.codename.startsWith('tool:'))
        .sort((a, b) => a.codename.localeCompare(b.codename)),
    [allPermissions],
  )
  const allToolPermIds = useMemo(() => allToolPerms.map((perm) => perm.id), [allToolPerms])
  // 循环内成员查询用 Set（避免每项渲染都做数组扫描）
  const toolIdSet = useMemo(() => new Set(toolIds), [toolIds])

  const allRoles = rolesQuery.data ?? ([] as Role[])
  // 角色区隐藏内置"工具使用者"（由下方工具权限二选一的 radio 唯一表达，避免重复出现）
  const visibleRoles = allRoles.filter((role) => role.name !== '工具使用者')

  // 弹窗每次打开由调用方 key 变化强制重挂载，toolMode / toolIds / 表单默认值天然重置，
  // 无需在 effect 中同步重置状态。

  // 切换工具权限模式：'all' 时全选工具；'custom' 时保留已勾选的自定义角色
  //（切回 'all' 时残留角色也保留，与全部工具直接权限叠加，符合合并语义）。
  const handleToolModeChange = (mode: 'all' | 'custom') => {
    setToolMode(mode)
    if (mode === 'all') {
      setToolIds(allToolPermIds)
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      // 'all' 模式：role_ids 留空则省略（后端默认分配"工具使用者"角色）；
      // 若勾选过自定义角色则原样提交（与全部工具直接权限叠加）。
      // 'custom' 模式：role_ids 传勾选集合（可为 []，后端不再默认分配）。
      const roleIds =
        toolMode === 'all'
          ? values.roleIds.length > 0
            ? values.roleIds
            : undefined
          : values.roleIds
      // 'all' 发送全部工具 id，'custom' 发送勾选集合
      await api.approveUser(
        currentRow.id,
        roleIds,
        toolMode === 'all' ? allToolPermIds : toolIds,
      )
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
            <span className='font-medium text-foreground'>
              {currentRow.username}
            </span>{' '}
            的注册申请，并为其分配初始角色。
          </DialogDescription>
        </DialogHeader>

        <form id='approve-user-form' onSubmit={onSubmit} className='flex flex-col gap-4'>
          <Controller
            control={control}
            name='roleIds'
            render={({ field }) => (
              <div className='flex flex-col gap-1.5'>
                <Label className='text-sm text-muted-foreground'>
                  分配角色（可留空）
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
                  visibleRoles.length === 0 && (
                    <p className='text-xs text-muted-foreground'>
                      暂无自定义角色可选（"工具使用者"由下方工具权限模式决定）。
                    </p>
                  )}
                {visibleRoles.map((role) => {
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
                      <span>{role.name}</span>
                      <span className='ml-auto text-xs text-muted-foreground'>
                        {role.permission_count} 项权限
                      </span>
                    </label>
                  )
                })}
                {errors.roleIds && (
                  <p className='text-sm text-destructive'>
                    {errors.roleIds.message}
                  </p>
                )}
              </div>
            )}
          />

          {/* 工具权限：二选一（工具使用者全部工具 / 自定义逐工具勾选），风格同角色编辑弹窗 */}
          <div className='flex flex-col gap-1.5 border-t pt-4'>
            <Label className='text-sm text-muted-foreground'>
              工具权限
            </Label>
            {permissionsQuery.isPending && (
              <p className='text-xs text-muted-foreground'>
                权限列表加载中...
              </p>
            )}
            <div className='flex flex-col gap-1 pt-0.5'>
              <label className='flex cursor-pointer items-center gap-2 text-sm'>
                <input
                  type='radio'
                  name='tool-permission-mode'
                  checked={toolMode === 'all'}
                  onChange={() => handleToolModeChange('all')}
                  className='size-4 accent-primary'
                />
                <span className='text-sm text-muted-foreground'>
                  工具使用者（全部工具）
                </span>
              </label>
              <label className='flex cursor-pointer items-center gap-2 text-sm'>
                <input
                  type='radio'
                  name='tool-permission-mode'
                  checked={toolMode === 'custom'}
                  onChange={() => handleToolModeChange('custom')}
                  className='size-4 accent-primary'
                />
                <span className='text-sm text-muted-foreground'>
                  自定义工具权限
                </span>
              </label>
            </div>
            {!permissionsQuery.isPending && allToolPerms.length === 0 && (
              <p className='text-xs text-muted-foreground'>
                暂无工具权限可选。
              </p>
            )}
            <div className='flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1 pt-1'>
              {allToolPerms.map((perm) => {
                // 「工具使用者」模式下复选框整体禁用，只能由 radio 统一授予/收回
                const disabled = toolMode === 'all'
                return (
                  <label
                    key={perm.id}
                    className={`flex items-center gap-2 text-sm ${
                      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    }`}
                  >
                    <Checkbox
                      checked={toolMode === 'all' || toolIdSet.has(perm.id)}
                      disabled={disabled}
                      onCheckedChange={(value) => {
                        setToolIds((prev) =>
                          value
                            ? [...prev, perm.id]
                            : prev.filter((id) => id !== perm.id),
                        )
                      }}
                    />
                    <code className='text-xs text-muted-foreground'>
                      {perm.codename}
                    </code>
                  </label>
                )
              })}
            </div>
          </div>
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
