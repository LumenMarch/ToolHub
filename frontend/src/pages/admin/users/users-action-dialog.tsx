import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import type { FieldErrors, UseFormRegister } from 'react-hook-form'
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
import { usePermission } from '@/hooks/use-permission'
import { adminPermissionsQueryKey, adminRolesQueryKey, adminUsersQueryKey } from './query-keys'
import { type User } from './schema'

type UserForm = z.infer<ReturnType<typeof buildFormSchema>>

interface ToolPermission {
  id: number
  codename: string
}

/** 校验规则：新建必须填密码（trim 后至少 6 位）；角色校验与工具权限模式联动——
 *  新建且 'custom' 模式必须至少勾选一个角色（'all' 模式由提交时自动补"工具使用者"角色兜底）；
 *  编辑时密码留空表示不修改，角色可为空（允许管理员清空角色）。 */
function buildFormSchema(isEdit: boolean, toolMode: 'all' | 'custom') {
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
            message: '密码长度至少 6 位',
          })
        }
      } else if (password.length < 6) {
        ctx.addIssue({
          code: 'custom',
          path: ['password'],
          message: '密码长度至少 6 位',
        })
      }
      // 新建且 'custom' 模式：无角色即无任何权限，要求至少勾选一个
      if (!isEdit && toolMode === 'custom' && data.roleIds.length < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['roleIds'],
          message: '至少选择一个角色',
        })
      }
    })
}

/** 用户名 + 密码字段区。 */
function UserCredentialsFields({
  register,
  errors,
  isEdit,
}: {
  register: UseFormRegister<UserForm>
  errors: FieldErrors<UserForm>
  isEdit: boolean
}) {
  return (
    <>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='user-username' className='text-sm text-muted-foreground'>
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
          <p className='text-sm text-destructive'>
            {errors.username.message}
          </p>
        )}
      </div>

      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='user-password' className='text-sm text-muted-foreground'>
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
          <p className='text-sm text-destructive'>
            {errors.password.message}
          </p>
        )}
      </div>
    </>
  )
}

/** 角色多选区（内置"工具使用者"角色不在此展示，由下方工具权限二选一唯一表达）。 */
function RolePicker({
  value,
  onChange,
  roles,
  pending,
  error,
  disabled,
  toolMode,
  isEdit,
}: {
  value: number[]
  onChange: (ids: number[]) => void
  roles: Role[]
  pending: boolean
  error?: string
  disabled: boolean
  toolMode: 'all' | 'custom'
  isEdit: boolean
}) {
  // 循环内成员查询用 Set，避免每项渲染都做数组扫描
  const valueSet = useMemo(() => new Set(value), [value])
  return (
    <div className='flex flex-col gap-1.5'>
      <Label className='text-sm text-muted-foreground'>
        角色{disabled && '（不能修改自己的角色）'}
        {!isEdit && toolMode === 'custom' && '（必选）'}
      </Label>
      {roles.length === 0 && !pending && (
        <p className='text-xs text-muted-foreground'>
          暂无自定义角色可选。
        </p>
      )}
      <div className='flex flex-col gap-1.5'>
        {roles.map((role) => {
          const checked = valueSet.has(role.id)
          return (
            <label
              key={role.id}
              className={`flex cursor-pointer items-center gap-2 text-sm ${
                disabled ? 'cursor-not-allowed opacity-60' : ''
              }`}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(c) => {
                  const next = c
                    ? [...value, role.id]
                    : value.filter((id) => id !== role.id)
                  onChange(next)
                }}
              />
              <span>{role.name}</span>
              <span className='ml-auto text-xs text-muted-foreground'>
                {role.permission_count} 项权限
              </span>
            </label>
          )
        })}
      </div>
      {error && (
        <p className='text-sm text-destructive'>
          {error}
        </p>
      )}
    </div>
  )
}

/** 工具权限二选一区：radio（工具使用者全部工具 / 自定义逐工具勾选）+ 勾选列表。 */
function ToolPermissionPicker({
  toolMode,
  onModeChange,
  allToolPerms,
  toolIdSet,
  onToggleToolId,
  disabled,
  isPending,
}: {
  toolMode: 'all' | 'custom'
  onModeChange: (mode: 'all' | 'custom') => void
  allToolPerms: ToolPermission[]
  toolIdSet: Set<number>
  onToggleToolId: (id: number, checked: boolean) => void
  disabled: boolean
  isPending: boolean
}) {
  return (
    <div className='flex flex-col gap-1.5 border-t pt-4'>
      <Label className='text-sm text-muted-foreground'>
        工具权限{disabled && '（不能修改自己的工具权限）'}
      </Label>
      {isPending && (
        <p className='text-xs text-muted-foreground'>
          权限列表加载中...
        </p>
      )}
      <div className='flex flex-col gap-1 pt-0.5'>
        <label
          className={`flex cursor-pointer items-center gap-2 text-sm ${
            disabled ? 'cursor-not-allowed opacity-60' : ''
          }`}
        >
          <input
            type='radio'
            name='tool-permission-mode'
            checked={toolMode === 'all'}
            disabled={disabled}
            onChange={() => onModeChange('all')}
            className='size-4 accent-primary'
          />
          <span className='text-sm text-muted-foreground'>
            工具使用者（全部工具）
          </span>
        </label>
        <label
          className={`flex cursor-pointer items-center gap-2 text-sm ${
            disabled ? 'cursor-not-allowed opacity-60' : ''
          }`}
        >
          <input
            type='radio'
            name='tool-permission-mode'
            checked={toolMode === 'custom'}
            disabled={disabled}
            onChange={() => onModeChange('custom')}
            className='size-4 accent-primary'
          />
          <span className='text-sm text-muted-foreground'>
            自定义工具权限
          </span>
        </label>
      </div>
      {!isPending && allToolPerms.length === 0 && (
        <p className='text-xs text-muted-foreground'>
          暂无工具权限可选。
        </p>
      )}
      <div className='flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1 pt-1'>
        {allToolPerms.map((perm) => {
          // 「工具使用者」模式（或编辑自己）下复选框整体禁用，只能由 radio 统一授予/收回
          const checkboxDisabled = toolMode === 'all' || disabled
          return (
            <label
              key={perm.id}
              className={`flex items-center gap-2 text-sm ${
                checkboxDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              }`}
            >
              <Checkbox
                checked={toolMode === 'all' || toolIdSet.has(perm.id)}
                disabled={checkboxDisabled}
                onCheckedChange={(value) => onToggleToolId(perm.id, !!value)}
              />
              <code className='text-xs text-muted-foreground'>
                {perm.codename}
              </code>
            </label>
          )
        })}
      </div>
    </div>
  )
}

/** 账号启用开关（仅编辑时显示）。 */
function AccountStatusField({
  value,
  onChange,
  disabled,
}: {
  value: boolean
  onChange: (value: boolean) => void
  disabled: boolean
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between ${
        disabled ? 'cursor-not-allowed opacity-60' : ''
      }`}
    >
      <span className='text-sm text-muted-foreground'>
        账号启用
      </span>
      <Checkbox
        checked={value}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(!!checked)}
      />
    </label>
  )
}

/** 工具权限二选一选择状态：初始模式由服务端数据渲染期派生（派生值 + 用户覆盖），
 *  自定义勾选集合在用户触碰前跟随派生的初始集合。弹窗每次打开由调用方 key 变化强制重挂载，
 *  状态天然回到初始值，无需 effect 回写。 */
function useToolPermissionSelection({
  isEdit,
  isSelf,
  directPermsReady,
  roleIdsReady,
  permissionsPending,
  rolesPending,
  allRoles,
  allToolPerms,
  allToolPermIds,
  allToolCodenames,
  directToolPermissions,
  userRoleIds,
}: {
  isEdit: boolean
  isSelf: boolean
  directPermsReady: boolean
  roleIdsReady: boolean
  permissionsPending: boolean
  rolesPending: boolean
  allRoles: Role[]
  allToolPerms: ToolPermission[]
  allToolPermIds: number[]
  allToolCodenames: string[]
  directToolPermissions: string[]
  userRoleIds: number[]
}) {
  const [toolModeOverride, setToolModeOverride] = useState<'all' | 'custom' | null>(null)
  // 自定义模式下用户手工勾选的工具权限 id（未触碰前以派生的初始集合展示）
  const [customToolIds, setCustomToolIds] = useState<number[]>([])
  const [customToolIdsTouched, setCustomToolIdsTouched] = useState(false)

  // 循环内成员查询统一用 Set，避免每项渲染都做数组扫描
  const directToolPermissionSet = useMemo(
    () => new Set(directToolPermissions),
    [directToolPermissions],
  )
  const userRoleIdSet = useMemo(() => new Set(userRoleIds), [userRoleIds])

  // 渲染期派生初始模式：编辑非自己且数据就绪时，持有"工具使用者"角色或直接权限覆盖
  // 全部工具 → 'all'；否则 'custom'。数据未就绪返回 null（跟随默认 'all'），用户切换后
  // 以 toolModeOverride 为准，不再回写状态。
  const derivedToolMode = useMemo<'all' | 'custom' | null>(() => {
    if (!isEdit || isSelf) return null
    if (!directPermsReady || !roleIdsReady || permissionsPending || rolesPending) return null
    const toolUserRole = allRoles.find((role) => role.name === '工具使用者')
    const holdsToolRole = !!toolUserRole && userRoleIdSet.has(toolUserRole.id)
    const holdsAll = allToolCodenames.every((codename) =>
      directToolPermissionSet.has(codename),
    )
    return holdsToolRole || holdsAll ? 'all' : 'custom'
  }, [
    isEdit,
    isSelf,
    directPermsReady,
    roleIdsReady,
    permissionsPending,
    rolesPending,
    allRoles,
    allToolCodenames,
    directToolPermissionSet,
    userRoleIdSet,
  ])

  const toolMode = toolModeOverride ?? derivedToolMode ?? 'all'

  // 自定义模式下派生的初始勾选集合（服务端直接权限对应的 id），用户勾选后以 customToolIds 为准
  const derivedCustomToolIds = useMemo(() => {
    if (derivedToolMode !== 'custom') return []
    return allToolPerms.flatMap((perm) =>
      directToolPermissionSet.has(perm.codename) ? [perm.id] : [],
    )
  }, [derivedToolMode, allToolPerms, directToolPermissionSet])

  const toolIds =
    toolMode === 'all'
      ? allToolPermIds
      : customToolIdsTouched
        ? customToolIds
        : derivedCustomToolIds
  const toolIdSet = useMemo(() => new Set(toolIds), [toolIds])

  const setToolMode = (mode: 'all' | 'custom') => {
    setToolModeOverride(mode)
    if (mode === 'all') return
    // 切到 'custom'：以当前展示集合为勾选基准（从未手工勾选时），保留既有勾选语义
    if (!customToolIdsTouched) {
      setCustomToolIdsTouched(true)
      setCustomToolIds(toolIds)
    }
  }

  const toggleToolId = (id: number, checked: boolean) => {
    setCustomToolIdsTouched(true)
    setCustomToolIds((prev) => {
      // 首次勾选以当前展示集合为基准（含服务端派生的预填），之后以 prev 为准
      const base = customToolIdsTouched ? prev : toolIds
      return checked ? [...base, id] : base.filter((tid) => tid !== id)
    })
  }

  return { toolMode, toolIds, toolIdSet, setToolMode, toggleToolId }
}

/** 新建 / 编辑用户弹窗：用户名 + 密码（编辑时留空不修改）+ 角色多选 + 工具权限二选一 + 启用状态。 */
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

  // /admin/roles 与 /admin/permissions 都要求 role:read，而用户管理页只要求 user:read。
  // 没有 role:read 的管理员不该被锁死：不发这两个查询，保存时也省略对应字段。
  const { has } = usePermission()
  const canReadRoles = has('role:read')

  const rolesQuery = useQuery({
    queryKey: adminRolesQueryKey,
    queryFn: () => api.listRoles(),
    staleTime: 60 * 1000,
    enabled: open && canReadRoles,
  })

  const permissionsQuery = useQuery({
    queryKey: adminPermissionsQueryKey,
    queryFn: () => api.listPermissions(),
    staleTime: 60 * 1000,
    enabled: open && canReadRoles,
  })

  // 该用户当前直接持有的工具权限 codename（编辑时从详情接口刷新，失败回退列表行数据）
  const [directToolPermissions, setDirectToolPermissions] = useState<string[]>([])
  // 直接工具权限数据是否就绪（决定 derivedToolMode 计算时机）
  const [directPermsReady, setDirectPermsReady] = useState(false)
  // 该用户当前持有的角色 id（getUserRoles 返回，参与 derivedToolMode 计算）
  const [userRoleIds, setUserRoleIds] = useState<number[]>([])
  // 用户角色数据是否就绪（决定 derivedToolMode 计算时机）
  const [roleIdsReady, setRoleIdsReady] = useState(false)
  // 角色加载是否失败：失败时必须阻止保存，否则表单会以空集合冒充「该用户没有角色」
  const [roleIdsError, setRoleIdsError] = useState(false)
  // 重新加载计数：驱动上面的异步加载 effect 重跑
  const [reloadKey, setReloadKey] = useState(0)

  // 全部 tool: 前缀权限：'all' 模式的全选集合，也是初始化时比较的基准
  const allPermissions = useMemo(() => permissionsQuery.data ?? [], [permissionsQuery.data])
  const allToolPerms = useMemo(
    () =>
      allPermissions
        .filter((perm) => perm.codename.startsWith('tool:'))
        .sort((a, b) => a.codename.localeCompare(b.codename)),
    [allPermissions],
  )
  const allToolPermIds = useMemo(() => allToolPerms.map((perm) => perm.id), [allToolPerms])
  const allToolCodenames = useMemo(
    () => allToolPerms.map((perm) => perm.codename),
    [allToolPerms],
  )

  const allRoles = useMemo(() => rolesQuery.data ?? ([] as Role[]), [rolesQuery.data])

  // 角色区隐藏内置"工具使用者"（由下方工具权限二选一的 radio 唯一表达，避免重复出现）
  const visibleRoles = allRoles.filter((role) => role.name !== '工具使用者')

  // 工具权限二选一状态：初始模式渲染期派生（工具使用者全部工具 / 自定义逐工具勾选）
  const { toolMode, toolIds, toolIdSet, setToolMode, toggleToolId } =
    useToolPermissionSelection({
      isEdit,
      isSelf,
      directPermsReady,
      roleIdsReady,
      permissionsPending: permissionsQuery.isPending,
      rolesPending: rolesQuery.isPending,
      allRoles,
      allToolPerms,
      allToolPermIds,
      allToolCodenames,
      directToolPermissions,
      userRoleIds,
    })

  const formSchema = useMemo(() => buildFormSchema(isEdit, toolMode), [isEdit, toolMode])

  // 表单初值由 currentRow 渲染期派生（values prop 在值变化时自动同步表单），
  // 弹窗每次打开由调用方 key 变化强制重挂载，无需 effect 中 reset。
  const formValues = useMemo(
    () =>
      currentRow
        ? {
            username: currentRow.username,
            password: '',
            roleIds: [] as number[],
            isActive: currentRow.is_active,
          }
        : { username: '', password: '', roleIds: [] as number[], isActive: true },
    [currentRow],
  )

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<UserForm>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', password: '', roleIds: [], isActive: true },
    values: formValues,
  })

  // 打开时异步加载用户角色与直接权限（编辑非自己）；getUserRoles / getUserDetail
  // 用取消标记防迟到响应覆盖新行。表单初值由 formValues 派生，模式由渲染期派生，
  // 打开重置由调用方 key 变化强制重挂载完成。
  useEffect(() => {
    if (!open) return
    if (!currentRow || isSelf || !canReadRoles) {
      // 新建 / 编辑自己 / 无 role:read：角色与工具权限均不可改（提交时不发送字段）
      setDirectToolPermissions([])
      setDirectPermsReady(true)
      setUserRoleIds([])
      setRoleIdsReady(true)
      setRoleIdsError(false)
      return
    }
    let cancelled = false
    setDirectPermsReady(false)
    setRoleIdsReady(false)
    setRoleIdsError(false)
    api
      .getUserRoles(currentRow.id)
      .then((roles) => {
        if (!cancelled) {
          const ids = roles.map((r) => r.id)
          setValue('roleIds', ids)
          setUserRoleIds(ids)
          setRoleIdsReady(true)
        }
      })
      .catch(() => {
        // 角色加载失败时不能按「无角色」继续：表单 roleIds 会是空集合，一旦保存
        // 后端按整体替换处理，等于清空该用户全部角色。保持未就绪并阻止保存。
        if (!cancelled) {
          setUserRoleIds([])
          setRoleIdsError(true)
          toast.error('用户角色加载失败，已禁用保存以免清空角色')
        }
      })
    api
      .getUserDetail(currentRow.id)
      .then((detail) => {
        if (!cancelled) {
          setDirectToolPermissions(detail.directToolPermissions)
          setDirectPermsReady(true)
        }
      })
      .catch(() => {
        // 详情接口暂不可用时回退列表行数据（列表响应同样携带 direct_tool_permissions）
        if (!cancelled) {
          setDirectToolPermissions(currentRow.directToolPermissions ?? [])
          setDirectPermsReady(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, currentRow, isSelf, canReadRoles, api, setValue, reloadKey])

  // 切换工具权限模式：'all' 时全选工具；切 'custom' 时自动取消「工具使用者」角色勾选，
  // 避免「工具使用者角色 + 自定义部分工具」的矛盾组合。
  const handleToolModeChange = (mode: 'all' | 'custom') => {
    setToolMode(mode)
    if (mode === 'custom') {
      const toolUserRole = allRoles.find((role) => role.name === '工具使用者')
      if (toolUserRole) {
        setValue(
          'roleIds',
          getValues('roleIds').filter((id) => id !== toolUserRole.id),
        )
      }
    }
  }

  // 保存门禁：角色/权限列表尚在加载时，表单里呈现的空集合只是「还没加载到」，
  // 而后端对非 None 的 role_ids / tool_permission_ids 做整体替换——此时提交
  // 就会把空集合写成真相，清空该用户的角色与直接权限，且提示仍是「已更新」。
  // 没有 role:read 时两个查询是 disabled 的，v5 里 disabled 查询恒为 isPending，
  // 不能把它算进"数据未就绪"，否则按钮永久不可用（连只改启用状态都做不到）。
  // 编辑自己不发送 role_ids / tool_permission_ids，因此不该被这两个列表的失败连带挡住
  const permissionsEditable = !(isEdit && isSelf)
  const listsLoading =
    permissionsEditable && canReadRoles && (rolesQuery.isPending || permissionsQuery.isPending)
  const dataReady = roleIdsReady && directPermsReady && !listsLoading
  // 列表加载失败时禁止保存：derivedToolMode 依赖 allToolPermIds，列表缺位会被
  // [].every() 判成「持有全部工具」，角色区随之隐藏「工具使用者」，提交的 role_ids
  // 就会把它摘掉；而 tool_permission_ids 又因 isError 不下发——目标用户会被清成零权限，
  // 界面提示却仍是「已更新用户」。这与角色加载失败是同一条数据损坏路径。
  const listsFailed =
    permissionsEditable && canReadRoles && (rolesQuery.isError || permissionsQuery.isError)
  // 新建同样要求能读到角色：POST /admin/users 对显式空 role_ids 与缺省都不分配角色，
  // 没有 role:read 时创建只会得到一个进不去任何工具的账号。
  const canSubmit =
    dataReady && !listsFailed && !roleIdsError && (isEdit || canReadRoles)

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && currentRow) {
        // 权限列表加载失败时不发送工具权限（undefined = 不修改），避免误清空直接权限
        const toolPermissionIds =
          isSelf || !canReadRoles || !directPermsReady || permissionsQuery.isError
            ? undefined
            : toolMode === 'all'
              ? allToolPermIds
              : toolIds
        await api.updateUser(currentRow.id, {
          is_active: values.isActive,
          // 未就绪同样按下发 undefined 处理：防御性兜底，避免任何路径把空数组当真相
          role_ids: isSelf || !canReadRoles || !roleIdsReady ? undefined : values.roleIds,
          password: values.password.trim() || undefined,
          // 编辑自己不发送工具权限（与 role_ids 对齐）；'all' 发送全部工具 id，'custom' 发送勾选集合
          toolPermissionIds,
        })
        toast.success(`已更新用户 ${currentRow.username}`)
      } else {
        // 新建：按工具模式发送 tool_permission_ids（'all' = 全部工具权限 id，'custom' = 勾选集合），
        // 与后端创建契约对齐，自定义工具权限选择不再被静默丢弃；
        // 权限列表加载失败时不发送（undefined = 后端不设置直接权限），避免误传空数组清空。
        // 'all' 模式仍自动补入"工具使用者"角色 id，保持"新建用户默认=工具使用者"的既有体验
        // （角色授予全部工具 + 直接权限全量并存不冲突，语义一致）
        const toolUserRole = allRoles.find((role) => role.name === '工具使用者')
        const roleIds =
          toolMode === 'all' && toolUserRole && !values.roleIds.includes(toolUserRole.id)
            ? [...values.roleIds, toolUserRole.id]
            : values.roleIds
        const input: UserCreateInput = {
          username: values.username.trim(),
          password: values.password.trim(),
          role_ids: roleIds,
          toolPermissionIds:
            permissionsQuery.isError
              ? undefined
              : toolMode === 'all'
                ? allToolPermIds
                : toolIds,
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

        <form id='user-form' onSubmit={onSubmit} className='flex flex-col gap-4'>
          <UserCredentialsFields register={register} errors={errors} isEdit={isEdit} />

          <Controller
            control={control}
            name='roleIds'
            render={({ field }) => (
              <RolePicker
                value={field.value}
                onChange={field.onChange}
                roles={visibleRoles}
                pending={rolesQuery.isPending}
                error={errors.roleIds?.message}
                disabled={isSelf}
                toolMode={toolMode}
                isEdit={isEdit}
              />
            )}
          />

          {/* 工具权限：二选一（工具使用者全部工具 / 自定义逐工具勾选），风格同角色编辑弹窗 */}
          <ToolPermissionPicker
            toolMode={toolMode}
            onModeChange={handleToolModeChange}
            allToolPerms={allToolPerms}
            toolIdSet={toolIdSet}
            onToggleToolId={toggleToolId}
            disabled={isSelf}
            isPending={permissionsQuery.isPending}
          />

          {isEdit && (
            <Controller
              control={control}
              name='isActive'
              render={({ field }) => (
                <AccountStatusField
                  value={field.value}
                  onChange={(value) => field.onChange(value)}
                  disabled={isSelf}
                />
              )}
            />
          )}
          {isEdit && isSelf && (
            <p className='text-sm text-muted-foreground'>
              不能停用自己的账号
            </p>
          )}
        </form>

        <DialogFooter
          // 有提示时才用两端对齐；否则 space-between 会把按钮挤到左侧
          className={
            roleIdsError || listsFailed || !canReadRoles ? 'sm:justify-between' : undefined
          }
        >
          {!canReadRoles ? (
            <p className='text-sm text-muted-foreground'>
              {isEdit
                ? '当前账号没有 role:read 权限，保存不会改动角色与工具权限'
                : '当前账号没有 role:read 权限，无法创建用户（无法分配角色）'}
            </p>
          ) : roleIdsError || listsFailed ? (
            <div className='flex flex-col items-start gap-2'>
              <p className='text-sm text-destructive'>
                {roleIdsError ? '用户角色加载失败' : '角色或权限列表加载失败'}
                ，继续保存会误清空其权限，已停用
              </p>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => {
                  setReloadKey((key) => key + 1)
                  void rolesQuery.refetch()
                  void permissionsQuery.refetch()
                }}
              >
                重新加载
              </Button>
            </div>
          ) : null}
          <div className='flex gap-2'>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type='submit' form='user-form' disabled={isSubmitting || !canSubmit}>
              {isSubmitting ? '保存中...' : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
