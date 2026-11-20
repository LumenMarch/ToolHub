import type { AdminUser, PermissionSummary } from '../../../api/admin'

export function toolPermissionOptions(permissions: PermissionSummary[]) {
  const options: Array<{ value: number; label: string }> = []
  for (const permission of permissions) {
    if (
      permission.codename.startsWith('tool:') &&
      permission.codename.endsWith(':use')
    ) {
      options.push({
        value: permission.id,
        label: permission.description || permission.codename,
      })
    }
  }
  return options
}

export function directPermissionIds(
  user: AdminUser | undefined,
  permissions: PermissionSummary[],
): number[] {
  if (!user) return []
  const direct = new Set(user.direct_tool_permissions)
  const ids: number[] = []
  for (const permission of permissions) {
    if (direct.has(permission.codename)) ids.push(permission.id)
  }
  return ids
}
