import { useCallback, useMemo } from 'react';
import api from '../api/axios';

// ===== 类型定义 =====

export interface AdminUser {
  id: number;
  username: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
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

// ===== 请求/响应参数类型 =====

export interface UserUpdateInput {
  is_admin?: boolean;
  is_active?: boolean;
  password?: string;
}

export interface UserCreateInput {
  username: string;
  password: string;
  is_admin?: boolean;
}

export interface ToolMetaUpdateInput {
  enabled?: boolean;
  sort_order?: number;
  custom_name?: string;
  custom_description?: string;
}

// ===== Hook =====

export function useAdminApi() {
  // 用户管理
  const listUsers = useCallback(
    (params?: { search?: string }) =>
      api
        .get<AdminUser[]>('/admin/users', { params })
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

  // 审计日志
  const listAuditLogs = useCallback(
    (params?: {
      skip?: number;
      limit?: number;
      user_id?: number;
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

  // 用 useMemo 稳定返回对象引用，避免下游 useEffect 把 api 作为依赖时陷入死循环。
  return useMemo(
    () => ({
      listUsers,
      createUser,
      updateUser,
      deleteUser,
      listAuditLogs,
      listToolMetas,
      updateToolMeta,
      bulkUpdateToolMetas,
      listPublicToolMetas,
      getOverview,
      getToolCalls,
      getDailyActiveUsers,
    }),
    [
      listUsers,
      createUser,
      updateUser,
      deleteUser,
      listAuditLogs,
      listToolMetas,
      updateToolMeta,
      bulkUpdateToolMetas,
      listPublicToolMetas,
      getOverview,
      getToolCalls,
      getDailyActiveUsers,
    ],
  );
}
