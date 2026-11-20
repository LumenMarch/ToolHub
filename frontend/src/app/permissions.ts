/**
 * 管理台入口权限白名单。
 * 持有任一权限即可看到管理入口；具体页面仍需各自的细项权限。
 */
export const ADMIN_PERMISSIONS = [
  'user:read',
  'user:write',
  'role:read',
  'role:write',
  'audit:read',
  'tool_meta:read',
  'tool_meta:write',
  'stats:read',
  'llm_config:read',
  'llm_config:write',
] as const

export function hasAdminAccess(permissions: readonly string[]): boolean {
  return permissions.some((permission) =>
    ADMIN_PERMISSIONS.includes(permission as (typeof ADMIN_PERMISSIONS)[number]),
  )
}
