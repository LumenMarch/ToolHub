import { useAuth } from './auth-context'
import { hasAdminAccess } from '../../app/permissions'

export function usePermission() {
  const { user } = useAuth()
  const permissions = user?.permissions ?? []
  return {
    permissions,
    has: (permission: string) => permissions.includes(permission),
    isAdmin: hasAdminAccess(permissions),
  }
}
