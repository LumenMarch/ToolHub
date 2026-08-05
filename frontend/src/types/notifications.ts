/** 站内通知（通知中心）——主站与控制台共享的类型定义。 */
export interface Notification {
  id: number;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationList {
  items: Notification[];
  total: number;
}

export interface UnreadCount {
  count: number;
}
