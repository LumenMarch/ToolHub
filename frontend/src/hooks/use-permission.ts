import { useContext, useCallback, useMemo } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * 管理权限白名单 — 持有任一即视为可进入控制台。
 * per-tool 授权后工具权限（tool:<id>:use）不再能作为管理入口判断依据。
 */
export const ADMIN_PERMISSIONS: string[] = [
  'user:read',
  'user:write',
  'role:read',
  'role:write',
  'audit:read',
  'tool_meta:read',
  'tool_meta:write',
  'stats:read',
];

/**
 * 权限检查 hook — 读取当前用户的权限集合并提供便捷的检查方法。
 */
export function usePermission() {
  const { user } = useContext(AuthContext);
  const permissions: string[] = useMemo(
    () => user?.permissions ?? [],
    [user?.permissions],
  );

  const has = useCallback(
    (perm: string) => permissions.includes(perm),
    [permissions],
  );

  return { has, permissions };
}
