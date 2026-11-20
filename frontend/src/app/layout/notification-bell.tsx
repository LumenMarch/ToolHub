import { useState } from 'react'
import {
  App as AntApp,
  Avatar,
  Badge,
  Button,
  Empty,
  Flex,
  List,
  Popover,
  Skeleton,
  Tag,
  theme,
  Typography,
} from 'antd'
import {
  BellOutlined,
  CheckCircleFilled,
  InfoCircleOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { parseServerDate } from '../../lib/date'
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications'
import type { NotificationItem } from '../../api/types'
import { notificationsQueryKey, notificationsUnreadKey } from '../../features/notifications/query-keys'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography

function formatRelative(iso: string): string {
  const time = parseServerDate(iso)
  if (!time.isValid()) return ''
  const minutes = dayjs().diff(time, 'minute')
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return time.format('MM-DD HH:mm')
}

export function NotificationBell() {
  const { token } = theme.useToken()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const listQuery = useQuery({
    queryKey: [...notificationsQueryKey, { limit: 20 }],
    queryFn: () => listNotifications(20),
    staleTime: 30_000,
    retry: 1,
  })

  const unreadQuery = useQuery({
    queryKey: notificationsUnreadKey,
    queryFn: getUnreadCount,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: notificationsQueryKey })

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: invalidate,
    onError: () => message.error('标记已读失败'),
  })

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: invalidate,
    onError: () => message.error('全部已读失败'),
  })

  const unreadCount = unreadQuery.data?.count ?? 0

  const handleClick = (item: NotificationItem) => {
    if (!item.read_at) markRead.mutate(item.id)
    const link = item.payload?.link
    if (typeof link === 'string' && link.startsWith('/')) {
      setOpen(false)
      navigate(link)
    }
  }

  const content = (
    <div style={{ width: 340 }}>
      <Flex justify="space-between" align="center" style={{ padding: '2px 0 10px' }}>
        <Text strong>通知中心</Text>
        <Button
          type="link"
          size="small"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          全部已读
        </Button>
      </Flex>
      {listQuery.isPending ? (
        <Flex vertical gap={10} style={{ padding: '8px 0' }}>
          <Skeleton active avatar paragraph={{ rows: 1 }} />
          <Skeleton active avatar paragraph={{ rows: 1 }} />
        </Flex>
      ) : listQuery.isError ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="通知加载失败" />
      ) : listQuery.data.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" />
      ) : (
        <List
          size="small"
          dataSource={listQuery.data.items}
          renderItem={(item) => {
            const unread = !item.read_at
            return (
              <List.Item
                style={{
                  paddingInline: 0,
                  cursor: 'pointer',
                  opacity: unread ? 1 : 0.65,
                }}
                onClick={() => handleClick(item)}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      size={30}
                      style={{
                        background: unread ? 'rgba(79, 70, 229, 0.12)' : token.colorFillQuaternary,
                        color: unread ? token.colorPrimary : token.colorTextTertiary,
                      }}
                      icon={unread ? <InfoCircleOutlined /> : <CheckCircleFilled />}
                    />
                  }
                  title={
                    <Flex justify="space-between" gap={8}>
                      <Text strong={unread} style={{ fontSize: 12 }}>
                        {item.title}
                      </Text>
                      {item.payload?.link ? (
                        <Tag bordered={false} style={{ marginInlineEnd: 0, fontSize: 10 }}>
                          可跳转
                        </Tag>
                      ) : null}
                    </Flex>
                  }
                  description={
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      {formatRelative(item.created_at)}
                    </Text>
                  }
                />
              </List.Item>
            )
          }}
        />
      )}
    </div>
  )

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      content={content}
      trigger="click"
      placement="bottomRight"
      styles={{ content: { padding: 14 } }}
    >
      <Badge count={unreadCount} size="small" offset={[-2, 2]}>
        <Button type="text" shape="circle" aria-label="通知中心" icon={<BellOutlined />} />
      </Badge>
    </Popover>
  )
}
