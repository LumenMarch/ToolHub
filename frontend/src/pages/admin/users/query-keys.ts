/** 用户列表查询前缀：列表 / 待审计数 / 弹窗失效共用。 */
export const adminUsersQueryKey = ['admin-users'] as const;

/** 角色列表共享查询（审批弹窗 / 新建编辑弹窗共用）。 */
export const adminRolesQueryKey = ['admin-roles'] as const;

/** 权限列表共享查询（工具权限二选一区共用）。 */
export const adminPermissionsQueryKey = ['admin-permissions'] as const;
