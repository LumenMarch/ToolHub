import { useContext, useCallback, useMemo } from 'react';
import { AuthContext } from '../context/auth-context';

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
