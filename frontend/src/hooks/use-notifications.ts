import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useAdminApi } from '../pages/admin/hooks/use-admin-api'
import { realtimeClient } from '../lib/realtime'

/** 通知列表查询前缀。 */
export const notificationsQueryKey = ['notifications'] as const

/** 未读计数查询前缀。 */
export const notificationsUnreadKey = ['notifications', 'unread-count'] as const

/** 通知事件类型：收到即视为有新通知，刷新未读计数与列表。 */
const NOTIFICATION_EVENT_TYPES = new Set([
  'user.status.updated',
  'job.terminal',
  'user.pending',
])

/**
 * 登录后全局订阅通知事件 → 失效通知查询（与其它订阅方互不影响）。
 * 事件即"通知"语义：无论事件是否与当前用户直接相关，都触发 refetch，
 * 由后端决定把通知写入谁的收件箱。
 * invalidateQueries 按前缀匹配，notificationsQueryKey 已覆盖未读计数子键，无需分别失效。
 */
export function useNotificationsRealtimeInvalidation() {
  const queryClient = useQueryClient()
  useEffect(() => {
    return realtimeClient.subscribe((event) => {
      if (NOTIFICATION_EVENT_TYPES.has(event.type)) {
        void queryClient.invalidateQueries({ queryKey: notificationsQueryKey })
      }
    })
  }, [queryClient])
}

/** 最近通知列表（默认最近 20 条）。 */
export function useNotifications(limit = 20) {
  const api = useAdminApi()
  return useQuery({
    queryKey: [...notificationsQueryKey, { limit }],
    queryFn: () => api.listNotifications({ skip: 0, limit }),
    staleTime: 30 * 1000,
  })
}

/** 未读通知计数。 */
export function useUnreadCount() {
  const api = useAdminApi()
  return useQuery({
    queryKey: notificationsUnreadKey,
    queryFn: () => api.getUnreadCount(),
    staleTime: 15 * 1000,
  })
}

/** 单条已读；成功后失效列表与计数（前缀匹配覆盖）。 */
export function useMarkNotificationRead() {
  const api = useAdminApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (notificationId: number) =>
      api.markNotificationRead(notificationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey })
    },
  })
}

/** 全部已读。 */
export function useMarkAllNotificationsRead() {
  const api = useAdminApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey })
    },
  })
}
