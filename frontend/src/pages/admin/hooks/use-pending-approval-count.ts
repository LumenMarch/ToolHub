import { useContext, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AuthContext } from '@/context/AuthContext'
import { realtimeClient } from '@/lib/realtime'
import { useAdminApi } from './use-admin-api'
import { adminUsersQueryKey } from '../users/query-keys'

/**
 * 侧边栏"待审批用户"计数：复用列表接口（status=pending, limit=1）取 total。
 * 仅当当前用户具备 user:read（可读用户列表）时发起请求。
 * 订阅 WS：user.pending（新注册广播，管理员可见）时刷新；
 * user.status.updated 是后端对当事用户的定向推送，管理员收不到，不在此订阅。
 * 审批动作（approve/reject）后列表查询已失效，计数随列表 refetch 自然更新。
 */
export function usePendingApprovalCount() {
  const api = useAdminApi()
  const queryClient = useQueryClient()
  const { user } = useContext(AuthContext)
  const hasUserRead = user?.permissions.includes('user:read') ?? false

  const query = useQuery({
    queryKey: [...adminUsersQueryKey, 'pending-count'],
    queryFn: () =>
      api
        .listUsers({ status: ['pending'], limit: 1 })
        .then((response) => response.total),
    enabled: hasUserRead,
    staleTime: 30 * 1000,
  })

  useEffect(() => {
    return realtimeClient.subscribe((event) => {
      if (event.type === 'user.pending') {
        void queryClient.invalidateQueries({ queryKey: adminUsersQueryKey })
      }
    })
  }, [queryClient])

  return query.data ?? 0
}
