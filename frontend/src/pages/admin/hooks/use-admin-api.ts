import { useCallback, useMemo } from 'react';
import api from '../../../api/axios';

// ===== 类型定义 =====

export interface AdminUser {
  id: number;
  username: string;
  is_active: boolean;
  /** 审批状态：pending 待审批 / approved 已批准 / rejected 已拒绝 */
  status: 'pending' | 'approved' | 'rejected';
  roles: string[];
  permissions: string[];
  created_at: string;
  last_login_at: string | null;
}

export interface AdminUserList {
  items: AdminUser[];
  total: number;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditLogList {
  items: AuditLog[];
  total: number;
}

export interface ToolMeta {
  id: number;
  tool_id: string;
  enabled: boolean;
  sort_order: number;
  custom_name: string | null;
  custom_description: string | null;
  updated_at: string;
}

export interface ToolMetaPublic {
  tool_id: string;
  enabled: boolean;
  sort_order: number;
  custom_name: string | null;
  custom_description: string | null;
}

export interface OverviewStats {
  total_users: number;
  active_users_7d: number;
  total_tools: number;
  audit_logs_today: number;
}

export interface ToolCallStat {
  action: string;
  count: number;
}

export interface DailyActiveStat {
  date: string;
  count: number;
}

export interface Role {
  id: number;
  name: string;
  description: string;
  permission_count: number;
}

export interface RoleDetail {
  id: number;
  name: string;
  description: string;
  permissions: Permission[];
}

export interface Permission {
  id: number;
  codename: string;
  description: string;
}

// ===== 请求/响应参数类型 =====

export interface UserUpdateInput {
  role_ids?: number[];
  is_active?: boolean;
  password?: string;
}

export interface UserCreateInput {
  username: string;
  password: string;
  role_ids?: number[];
}

export interface ToolMetaUpdateInput {
  enabled?: boolean;
  sort_order?: number;
  custom_name?: string;
  custom_description?: string;
}

export interface RoleCreateInput {
  name: string;
  description?: string;
}

export interface RoleUpdateInput {
  name?: string;
  description?: string;
}

// ===== Hook =====

export function useAdminApi() {
  // 用户管理
  const listUsers = useCallback(
    (params?: {
      search?: string;
      /** 审批状态过滤（契约：逗号分隔多值） */
      status?: string[];
      skip?: number;
      limit?: number;
    }) =>
      api
        .get<AdminUserList>('/admin/users', {
          params: {
            ...params,
            // 契约要求 status 为逗号分隔字符串（如 "pending,approved"）
            status: params?.status?.length
              ? params.status.join(',')
              : undefined,
          },
        })
        .then((r) => r.data),
    [],
  );

  const createUser = useCallback(
    (input: UserCreateInput) =>
      api.post<AdminUser>('/admin/users', input).then((r) => r.data),
    [],
  );

  const updateUser = useCallback(
    (userId: number, input: UserUpdateInput) =>
      api.patch<AdminUser>(`/admin/users/${userId}`, input).then((r) => r.data),
    [],
  );

  const deleteUser = useCallback(
    (userId: number) =>
      api.delete(`/admin/users/${userId}`).then((r) => r.data),
    [],
  );

  // 审批流：批准（可指定角色，空则服务端默认"工具使用者"）/ 拒绝
  // 说明：rejected → approved 的恢复复用 approve 端点，后端无 /restore。
  const approveUser = useCallback(
    (userId: number, roleIds?: number[]) =>
      api
        .post<AdminUser>(`/admin/users/${userId}/approve`, {
          role_ids: roleIds,
        })
        .then((r) => r.data),
    [],
  );

  const rejectUser = useCallback(
    (userId: number, reason?: string) =>
      api
        .post<AdminUser>(
          `/admin/users/${userId}/reject`,
          reason ? { reason } : undefined,
        )
        .then((r) => r.data),
    [],
  );

  // 审计日志
  const listAuditLogs = useCallback(
    (params?: {
      skip?: number;
      limit?: number;
      user_id?: number;
      username?: string;
      action?: string;
      action_prefix?: string;
      date_from?: string;
      date_to?: string;
    }) =>
      api
        .get<AuditLogList>('/admin/audit', { params })
        .then((r) => r.data),
    [],
  );

  // 工具元数据
  const listToolMetas = useCallback(
    () => api.get<ToolMeta[]>('/admin/tools').then((r) => r.data),
    [],
  );

  const updateToolMeta = useCallback(
    (toolId: string, input: ToolMetaUpdateInput) =>
      api
        .patch<ToolMeta>(`/admin/tools/${toolId}`, input)
        .then((r) => r.data),
    [],
  );

  const bulkUpdateToolMetas = useCallback(
    (items: Array<ToolMetaUpdateInput & { tool_id: string }>) =>
      api.put<ToolMeta[]>('/admin/tools', { items }).then((r) => r.data),
    [],
  );

  // 公开工具元数据（已登录用户可读）
  const listPublicToolMetas = useCallback(
    () => api.get<ToolMetaPublic[]>('/tools-meta').then((r) => r.data),
    [],
  );

  // 统计
  const getOverview = useCallback(
    () => api.get<OverviewStats>('/admin/stats/overview').then((r) => r.data),
    [],
  );

  const getToolCalls = useCallback(
    () => api.get<ToolCallStat[]>('/admin/stats/tools').then((r) => r.data),
    [],
  );

  const getDailyActiveUsers = useCallback(
    (days = 7) =>
      api
        .get<DailyActiveStat[]>('/admin/stats/active-users', {
          params: { days },
        })
        .then((r) => r.data),
    [],
  );

  // 角色管理
  const listRoles = useCallback(
    () => api.get<Role[]>('/admin/roles').then((r) => r.data),
    [],
  );

  const createRole = useCallback(
    (input: RoleCreateInput) =>
      api.post<Role>('/admin/roles', input).then((r) => r.data),
    [],
  );

  const updateRole = useCallback(
    (roleId: number, input: RoleUpdateInput) =>
      api.patch<RoleDetail>(`/admin/roles/${roleId}`, input).then((r) => r.data),
    [],
  );

  const deleteRole = useCallback(
    (roleId: number) =>
      api.delete(`/admin/roles/${roleId}`).then((r) => r.data),
    [],
  );

  const listPermissions = useCallback(
    () => api.get<Permission[]>('/admin/permissions').then((r) => r.data),
    [],
  );

  const getRolePermissions = useCallback(
    (roleId: number) =>
      api
        .get<Permission[]>(`/admin/roles/${roleId}/permissions`)
        .then((r) => r.data),
    [],
  );

  const updateRolePermissions = useCallback(
    (roleId: number, permissionIds: number[]) =>
      api
        .put<RoleDetail>(`/admin/roles/${roleId}/permissions`, {
          permission_ids: permissionIds,
        })
        .then((r) => r.data),
    [],
  );

  const getUserRoles = useCallback(
    (userId: number) =>
      api.get<Role[]>(`/admin/users/${userId}/roles`).then((r) => r.data),
    [],
  );

  const updateUserRoles = useCallback(
    (userId: number, roleIds: number[]) =>
      api
        .patch<Role[]>(`/admin/users/${userId}/roles`, {
          role_ids: roleIds,
        })
        .then((r) => r.data),
    [],
  );

  return useMemo(
    () => ({
      listUsers,
      createUser,
      updateUser,
      deleteUser,
      approveUser,
      rejectUser,
      listAuditLogs,
      listToolMetas,
      updateToolMeta,
      bulkUpdateToolMetas,
      listPublicToolMetas,
      getOverview,
      getToolCalls,
      getDailyActiveUsers,
      listRoles,
      createRole,
      updateRole,
      deleteRole,
      listPermissions,
      getRolePermissions,
      updateRolePermissions,
      getUserRoles,
      updateUserRoles,
    }),
    [
      listUsers,
      createUser,
      updateUser,
      deleteUser,
      approveUser,
      rejectUser,
      listAuditLogs,
      listToolMetas,
      updateToolMeta,
      bulkUpdateToolMetas,
      listPublicToolMetas,
      getOverview,
      getToolCalls,
      getDailyActiveUsers,
      listRoles,
      createRole,
      updateRole,
      deleteRole,
      listPermissions,
      getRolePermissions,
      updateRolePermissions,
      getUserRoles,
      updateUserRoles,
    ],
  );
}
