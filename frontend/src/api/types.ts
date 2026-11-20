export interface User {
  id: number
  username: string
  is_active: boolean
  status?: 'pending' | 'approved' | 'rejected'
  current_session_id?: string | null
  roles: string[]
  permissions: string[]
  direct_tool_permissions?: string[]
}

export interface ToolMetaOverride {
  tool_id: string
  enabled: boolean
  sort_order: number
  custom_name: string | null
  custom_description: string | null
}

export interface NotificationItem {
  id: number
  type: string
  title: string
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export interface NotificationList {
  items: NotificationItem[]
  total: number
}

export interface UnreadCount {
  count: number
}

export type QrCodeLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrCodeResult {
  mime_type: string
  text: string
  base64: string
  data_uri: string
}

export interface QrCodeResponse {
  result: QrCodeResult
}
