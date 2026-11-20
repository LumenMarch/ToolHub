export const adminOverviewQueryKey = ['admin', 'stats', 'overview'] as const
export const adminToolCallsQueryKey = (days: number) =>
  ['admin', 'stats', 'tools', days] as const
export const adminDailyActiveQueryKey = (days: number) =>
  ['admin', 'stats', 'active-users', days] as const
export const adminUsersQueryKey = (params: object) =>
  ['admin', 'users', params] as const
export const adminUserSessionsQueryKey = (userId: number) =>
  ['admin', 'users', userId, 'sessions'] as const
export const adminRolesQueryKey = ['admin', 'roles'] as const
export const adminPermissionsQueryKey = ['admin', 'permissions'] as const
export const adminRolePermissionsQueryKey = (roleId: number) =>
  ['admin', 'roles', roleId, 'permissions'] as const
export const adminAuditQueryKey = (params: object) =>
  ['admin', 'audit', params] as const
export const adminToolsQueryKey = ['admin', 'tools'] as const
export const adminLlmConfigQueryKey = ['admin', 'llm', 'config'] as const
export const adminLlmStatusQueryKey = ['admin', 'llm', 'status'] as const
export const adminPendingCountQueryKey = ['admin', 'users', 'pending-count'] as const
