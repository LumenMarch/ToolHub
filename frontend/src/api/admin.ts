import { api } from './client'
import type { User } from './types'

export interface AdminUser extends Omit<User, 'status'> {
  status: 'pending' | 'approved' | 'rejected'
  online: boolean
  created_at: string
  last_login_at: string | null
  role_ids: number[]
  direct_tool_permissions: string[]
}

export interface AdminUserList {
  items: AdminUser[]
  total: number
}

export interface RoleSummary {
  id: number
  name: string
  description: string
  permission_count: number
  is_builtin: boolean
}

export interface PermissionSummary {
  id: number
  codename: string
  description: string
}

export interface AuditLogEntry {
  id: number
  user_id: number | null
  username: string | null
  action: string
  target_type: string | null
  target_id: string | null
  detail: string | null
  ip_address: string | null
  created_at: string
}

export interface AuditLogList {
  items: AuditLogEntry[]
  total: number
}

export interface AdminToolMeta {
  id: number
  tool_id: string
  enabled: boolean
  sort_order: number
  custom_name: string | null
  custom_description: string | null
  updated_at: string
}

export interface OverviewStats {
  total_users: number
  active_users_7d: number
  total_tools: number
  audit_logs_today: number
}

export interface ToolCallStat {
  action: string
  count: number
}

export interface DailyActiveStat {
  date: string
  count: number
}

export interface UserSession {
  id: number
  jti: string
  ip: string | null
  user_agent: string | null
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

export interface LlmEffectiveConfig {
  enabled: boolean
  provider: string
  baseUrl: string
  model: string
  timeoutSeconds: number
  connectTimeoutSeconds: number
  maxTokens: number
  temperature: number
  reasoningEffort: string
  numCtx: number
  maxConcurrency: number
  maxQueued: number
  maxRetries: number
  retryBaseDelaySeconds: number
  allowedFailures: number
  cooldownSeconds: number
  cacheTtlSeconds: number
  cacheMaxEntries: number
  healthCacheTtlSeconds: number
  apiKeySet: boolean
  apiKeyMask: string
  source: 'env' | 'db'
}

export interface LlmConfig {
  effective: LlmEffectiveConfig
  overrides: Record<string, unknown>
  overriddenFields: string[]
  envDefaults: Record<string, unknown>
  version: number
  updated_at: string | null
  updated_by: string | null
}

export interface LlmProbe {
  ok: boolean
  reachable: boolean
  models: string[]
  error: string | null
  capabilities: Record<string, unknown> | null
}

export interface LlmStatus {
  enabled: boolean
  configured: boolean
  available: boolean
  cooldownActive: boolean
  lastError: string | null
  model: string
  provider: string
  lastProbe: LlmProbe | null
  modelListed: boolean | null
  supportedProviders: string[]
  source: 'env' | 'db'
  baseUrl: string
  apiKeySet: boolean
  apiKeyMask: string
  gate: {
    capacity: number
    maxQueued: number
    inflight: number
    queued: number
  }
  cache: {
    entries: number
    capacity: number
    ttlSeconds: number
    hits: number
    misses: number
    evictions: number
    hitPercent: number
  }
  metrics: {
    requests: number
    ok: number
    cached: number
    errors: number
    rejections: number
    errorPercent: number
    p50LatencyMs: number
    p95LatencyMs: number
    maxLatencyMs: number
    latencySamples: number
    promptTokens: number
    completionTokens: number
    inflight: number
    queued: number
    peakQueued: number
    errorCodes: Record<string, number>
    cooldownActive: boolean
    cooldownSince: number | null
    uptimeSeconds: number
    bySource: Record<string, Record<string, number>>
  }
}

export interface AdminUserCreate {
  username: string
  password: string
  role_ids?: number[]
  tool_permission_ids?: number[]
}

export interface AdminUserUpdate {
  role_ids?: number[]
  is_active?: boolean
  password?: string
  tool_permission_ids?: number[]
}

export interface UserApproveRequest {
  role_ids?: number[]
  tool_permission_ids?: number[]
}

export async function getOverview(): Promise<OverviewStats> {
  const response = await api.get<OverviewStats>('/admin/stats/overview')
  return response.data
}

export async function getToolCalls(days: number): Promise<ToolCallStat[]> {
  const response = await api.get<ToolCallStat[]>('/admin/stats/tools', { params: { days } })
  return response.data
}

export async function getDailyActive(days: number): Promise<DailyActiveStat[]> {
  const response = await api.get<DailyActiveStat[]>('/admin/stats/active-users', {
    params: { days },
  })
  return response.data
}

export async function listAdminUsers(params: {
  skip: number
  limit: number
  search?: string
  status?: string
}): Promise<AdminUserList> {
  const response = await api.get<AdminUserList>('/admin/users', { params })
  return response.data
}

export async function createAdminUser(body: AdminUserCreate): Promise<AdminUser> {
  const response = await api.post<AdminUser>('/admin/users', body)
  return response.data
}

export async function updateAdminUser(
  id: number,
  body: AdminUserUpdate,
): Promise<AdminUser> {
  const response = await api.patch<AdminUser>(`/admin/users/${id}`, body)
  return response.data
}

export async function approveAdminUser(
  id: number,
  body: UserApproveRequest,
): Promise<AdminUser> {
  const response = await api.post<AdminUser>(`/admin/users/${id}/approve`, body)
  return response.data
}

export async function rejectAdminUser(id: number, reason?: string): Promise<AdminUser> {
  const response = await api.post<AdminUser>(`/admin/users/${id}/reject`, { reason })
  return response.data
}

export async function deleteAdminUser(id: number): Promise<void> {
  await api.delete(`/admin/users/${id}`)
}

export async function listUserSessions(userId: number): Promise<UserSession[]> {
  const response = await api.get<UserSession[]>(`/admin/users/${userId}/sessions`)
  return response.data
}

export async function revokeUserSession(
  userId: number,
  sessionId: number,
): Promise<UserSession> {
  const response = await api.post<UserSession>(
    `/admin/users/${userId}/sessions/${sessionId}/revoke`,
  )
  return response.data
}

export async function listRoles(): Promise<RoleSummary[]> {
  const response = await api.get<RoleSummary[]>('/admin/roles')
  return response.data
}

export async function createRole(body: {
  name: string
  description: string
}): Promise<RoleSummary> {
  const response = await api.post<RoleSummary>('/admin/roles', body)
  return response.data
}

export async function updateRole(
  id: number,
  body: { name?: string; description?: string },
): Promise<RoleSummary> {
  const response = await api.patch<RoleSummary>(`/admin/roles/${id}`, body)
  return response.data
}

export async function deleteRole(id: number): Promise<void> {
  await api.delete(`/admin/roles/${id}`)
}

export async function listPermissions(): Promise<PermissionSummary[]> {
  const response = await api.get<PermissionSummary[]>('/admin/permissions')
  return response.data
}

export async function getRolePermissions(roleId: number): Promise<PermissionSummary[]> {
  const response = await api.get<PermissionSummary[]>(`/admin/roles/${roleId}/permissions`)
  return response.data
}

export async function setRolePermissions(
  roleId: number,
  permissionIds: number[],
): Promise<RoleSummary> {
  const response = await api.put<RoleSummary>(`/admin/roles/${roleId}/permissions`, {
    permission_ids: permissionIds,
  })
  return response.data
}

export async function listAuditLogs(params: {
  skip: number
  limit: number
  username?: string
  action?: string
  action_prefix?: string
  date_from?: string
  date_to?: string
}): Promise<AuditLogList> {
  const response = await api.get<AuditLogList>('/admin/audit', { params })
  return response.data
}

export async function listAdminToolMetas(): Promise<AdminToolMeta[]> {
  const response = await api.get<AdminToolMeta[]>('/admin/tools')
  return response.data
}

export async function bulkUpdateAdminToolMetas(
  items: Array<Partial<AdminToolMeta> & { tool_id: string }>,
): Promise<AdminToolMeta[]> {
  const response = await api.put<AdminToolMeta[]>('/admin/tools', { items })
  return response.data
}

export async function getLlmConfig(): Promise<LlmConfig> {
  const response = await api.get<LlmConfig>('/admin/llm/config')
  return response.data
}

export async function updateLlmConfig(
  body: Record<string, unknown>,
): Promise<LlmConfig> {
  const response = await api.patch<LlmConfig>('/admin/llm/config', body)
  return response.data
}

export async function resetLlmConfig(): Promise<LlmConfig> {
  const response = await api.delete<LlmConfig>('/admin/llm/config')
  return response.data
}

export async function probeLlm(): Promise<
  LlmProbe & {
    expectedModel?: string
    modelListed?: boolean | null
    supportedProviders?: string[]
  }
> {
  const response = await api.post<
    LlmProbe & {
      expectedModel?: string
      modelListed?: boolean | null
      supportedProviders?: string[]
    }
  >('/admin/llm/probe')
  return response.data
}

export async function getLlmStatus(probe = false): Promise<LlmStatus> {
  const response = await api.get<LlmStatus>('/llm/status', {
    params: probe ? { probe: true } : undefined,
  })
  return response.data
}
