import { useQuery } from '@tanstack/react-query'
import { listAdminUsers } from '../../api/admin'
import { usePermission } from '../auth/use-permission'
import { adminPendingCountQueryKey } from './query-keys'

export function usePendingApprovalCount() {
  const { has } = usePermission()
  const query = useQuery({
    queryKey: adminPendingCountQueryKey,
    queryFn: () => listAdminUsers({ skip: 0, limit: 1, status: 'pending' }),
    enabled: has('user:read'),
    staleTime: 30_000,
    select: (data) => data.total,
  })
  return query.data ?? 0
}
