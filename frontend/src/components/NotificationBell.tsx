import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/hooks/use-notifications'
import type { Notification } from '@/types/notifications'
import { parseServerDate } from '@/lib/format-time'

function formatRelativeTime(iso: string) {
  const time = parseServerDate(iso)?.getTime()
  if (time === undefined || Number.isNaN(time)) return ''
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return (
    parseServerDate(iso)?.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }) ?? ''
  )
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const listQuery = useNotifications(20)
  const unreadQuery = useUnreadCount()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const [locallyRead, setLocallyRead] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!listQuery.data) return
    const serverRead = new Set<number>()
    for (const item of listQuery.data.items) {
      if (item.read_at) serverRead.add(item.id)
    }
    setLocallyRead((prev) => {
      const next = new Set(prev)
      for (const id of serverRead) next.delete(id)
      return next
    })
  }, [listQuery.data])

  const unreadCount = unreadQuery.data?.count ?? 0

  const handleRead = (notification: Notification) => {
    if (notification.read_at || locallyRead.has(notification.id)) return
    setLocallyRead((prev) => new Set(prev).add(notification.id))
    markRead.mutate(notification.id, {
      onError: () => {
        setLocallyRead((prev) => {
          const next = new Set(prev)
          next.delete(notification.id)
          return next
        })
        toast.error('标记已读失败')
      },
    })
  }

  const handleMarkAll = () => {
    if (unreadCount === 0) return
    markAll.mutate(undefined, {
      onError: () => toast.error('全部已读失败'),
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="通知中心"
          title="通知中心"
        >
          <Bell />
          {unreadCount > 0 ? (
            <Badge
              variant="default"
              className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]"
              title={`${unreadCount} 条未读通知`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">通知中心</span>
          {unreadCount > 0 ? (
            <Badge variant="secondary">{unreadCount} 未读</Badge>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {listQuery.isPending ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : listQuery.isError ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyTitle>通知加载失败</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : listQuery.data.items.length === 0 ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyTitle>暂无通知</EmptyTitle>
                <EmptyDescription>新的系统通知会显示在这里。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul>
              {listQuery.data.items.map((notification) => {
                const isUnread =
                  !notification.read_at && !locallyRead.has(notification.id)
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => handleRead(notification)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50',
                        isUnread && 'bg-muted/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          isUnread ? 'bg-primary' : 'bg-transparent',
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block text-sm leading-snug',
                            !isUnread && 'text-muted-foreground',
                          )}
                        >
                          {notification.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {formatRelativeTime(notification.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleMarkAll}
            disabled={unreadCount === 0 || markAll.isPending}
          >
            全部已读
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
