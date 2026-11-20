import {
  Avatar,
  Button,
  Drawer,
  Empty,
  Flex,
  List,
  Popconfirm,
  Skeleton,
  Space,
  Tag,
  theme,
  Typography,
} from 'antd'
import { LaptopOutlined, LogoutOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listUserSessions, revokeUserSession } from '../../../api/admin'
import type { AdminUser, UserSession } from '../../../api/admin'
import { parseServerDate } from '../../../lib/date'
import { usePermission } from '../../auth/use-permission'
import { adminUserSessionsQueryKey } from '../query-keys'

const { Text } = Typography

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = parseServerDate(value)
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : '—'
}

function describeAgent(userAgent: string | null): string {
  if (!userAgent) return '未知设备'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Safari\//.test(userAgent)
        ? 'Safari'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : '浏览器'
  const system = /Macintosh|Mac OS X/.test(userAgent)
    ? 'macOS'
    : /Windows/.test(userAgent)
      ? 'Windows'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '未知系统'
  return `${browser} · ${system}`
}

function sessionStatus(session: UserSession): {
  label: string
  color: string
} {
  if (session.revoked_at) return { label: '已下线', color: 'red' }
  const lastSeen = session.last_seen_at ? parseServerDate(session.last_seen_at) : null
  const online = lastSeen?.isValid() && Date.now() - lastSeen.valueOf() < 15 * 60_000
  return online ? { label: '在线', color: 'green' } : { label: '离线', color: 'default' }
}

export function UserSessionsDrawer({
  user,
  onClose,
}: {
  user: AdminUser
  onClose: () => void
}) {
  const { token } = theme.useToken()
  const { has } = usePermission()
  const queryClient = useQueryClient()
  const key = adminUserSessionsQueryKey(user.id)

  const sessionsQuery = useQuery({
    queryKey: key,
    queryFn: () => listUserSessions(user.id),
    staleTime: 15_000,
  })

  const revokeMutation = useMutation({
    mutationFn: (sessionId: number) => revokeUserSession(user.id, sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })

  return (
    <Drawer
      open
      onClose={onClose}
      size="large"
      title={`登录会话 · ${user.username}`}
      extra={<Text type="secondary">{sessionsQuery.data?.length ?? 0} 个会话</Text>}
    >
      {sessionsQuery.isPending ? (
        <Flex vertical gap={10}>
          <Skeleton active paragraph={{ rows: 2 }} />
          <Skeleton active paragraph={{ rows: 2 }} />
        </Flex>
      ) : sessionsQuery.isError ? (
        <Empty description="会话列表加载失败" />
      ) : sessionsQuery.data.length === 0 ? (
        <Empty description="暂无会话" />
      ) : (
        <List
          dataSource={sessionsQuery.data}
          renderItem={(session) => {
            const status = sessionStatus(session)
            return (
              <List.Item
                style={{ paddingInline: 0 }}
                actions={[
                  has('user:write') && !session.revoked_at ? (
                    <Popconfirm
                      key="revoke"
                      title="强制下线该会话？"
                      description="该设备会立即被登出。"
                      okText="确认下线"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => revokeMutation.mutate(session.id)}
                    >
                      <Button
                        danger
                        size="small"
                        icon={<LogoutOutlined />}
                        loading={revokeMutation.isPending && revokeMutation.variables === session.id}
                      >
                        强制下线
                      </Button>
                    </Popconfirm>
                  ) : null,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      style={{ background: token.colorFillQuaternary, color: token.colorTextSecondary }}
                      icon={<LaptopOutlined />}
                    />
                  }
                  title={
                    <Space size={8} wrap>
                      <Text strong>{describeAgent(session.user_agent)}</Text>
                      <Tag
                        color={status.color}
                        bordered={false}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {status.label}
                      </Tag>
                    </Space>
                  }
                  description={
                    <Flex vertical gap={2}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        IP {session.ip ?? '—'} · 创建 {formatDate(session.created_at)}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        最后活跃 {formatDate(session.last_seen_at)}
                        {session.revoked_at ? ` · 下线 ${formatDate(session.revoked_at)}` : ''}
                      </Text>
                      <Text type="secondary" className="mono" style={{ fontSize: 10 }}>
                        {session.jti}
                      </Text>
                    </Flex>
                  }
                />
              </List.Item>
            )
          }}
        />
      )}
    </Drawer>
  )
}
