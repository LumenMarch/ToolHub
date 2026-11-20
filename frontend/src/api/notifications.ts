import { api } from './client'
import type { NotificationList, UnreadCount } from './types'

export async function listNotifications(limit = 20): Promise<NotificationList> {
  const response = await api.get<NotificationList>('/notifications', {
    params: { limit },
  })
  return response.data
}

export async function getUnreadCount(): Promise<UnreadCount> {
  const response = await api.get<UnreadCount>('/notifications/unread-count')
  return response.data
}

export async function markNotificationRead(id: number): Promise<void> {
  await api.post(`/notifications/${id}/read`)
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/notifications/read-all')
}
