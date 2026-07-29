import { usePermission } from '../../hooks/use-permission';
import type { ReactNode } from 'react';

interface PermissionGuardProps {
  permission: string;
  children: ReactNode;
  /** 权限不足时显示的替代内容，默认 null（隐藏）。 */
  fallback?: ReactNode;
}

/**
 * 按权限控制子组件可见性。
 *
 * 用法:
 *   <PermissionGuard permission="user:read">
 *     <UserList />
 *   </PermissionGuard>
 */
export default function PermissionGuard({
  permission,
  children,
  fallback = null,
}: PermissionGuardProps) {
  const { has } = usePermission();
  return has(permission) ? <>{children}</> : <>{fallback}</>;
}
