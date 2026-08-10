import type { AdminUser } from '../hooks/use-admin-api';

/** 审批状态：pending 待审批 / approved 已批准 / rejected 已拒绝 */
export type UserStatus = 'pending' | 'approved' | 'rejected';

/** 用户表行数据类型：直接复用后端契约的 AdminUser
 *  （含 directToolPermissions，由 API 层把后端 direct_tool_permissions 映射而来）。 */
export type User = AdminUser;
