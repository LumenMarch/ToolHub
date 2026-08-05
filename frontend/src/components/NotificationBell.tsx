import { useEffect, useState } from 'react'
import { Bell } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/hooks/use-notifications'
import type { Notification } from '@/types/notifications'

/** 后端时间戳为无时区 UTC：补 Z 再解析为真实时刻，避免按本地时间误读产生偏移。 */
function parseServerDate(iso: string) {
  const hasTimezone = /(Z|[+-]\d{2}:?\d{2})$/i.test(iso)
  return new Date(hasTimezone ? iso : `${iso}Z`)
}

/** 相对时间（中文）：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期。 */
function formatRelativeTime(iso: string) {
  const time = parseServerDate(iso).getTime()
  if (Number.isNaN(time)) return ''
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return parseServerDate(iso).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/**
 * 通知铃铛（主站 / 控制台共用）：未读徽标 + 最近通知下拉面板。
 * 点击条目 → POST 已读 + 本地置灰；底部"全部已读"；空态与错误态。
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const listQuery = useNotifications(20)
  const unreadQuery = useUnreadCount()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  // 本地"已点读"集合：点击后立即置灰，不等后端往返
  const [locallyRead, setLocallyRead] = useState<Set<number>>(new Set())

  // 服务端已读后从本地集合剔除，避免集合无限增长
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
        // 回滚乐观置灰：失败后可重试，且集合不会永久残留该 id
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
          variant='ghost'
          size='icon'
          className='relative'
          aria-label='通知中心'
          title='通知中心'
        >
          <Bell className='size-5' />
          {unreadCount > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center border border-background bg-primary px-1 font-mono text-[10px] leading-4 text-primary-foreground"
              title={`${unreadCount} 条未读通知`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='end'
        sideOffset={8}
        className='w-80 p-0'
      >
        <div className='flex items-center justify-between border-b border-border px-4 py-3'>
          <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            通知中心
          </span>
          {unreadCount > 0 && (
            <span className='font-mono text-[11px] text-primary'>
              {unreadCount} 未读
            </span>
          )}
        </div>

        <div className='max-h-80 overflow-y-auto'>
          {listQuery.isPending ? (
            <div className='px-4 py-10 text-center text-[11px] font-mono uppercase tracking-widest text-muted-foreground'>
              加载中...
            </div>
          ) : listQuery.isError ? (
            <div className='px-4 py-10 text-center text-[11px] font-mono uppercase tracking-widest text-destructive'>
              通知加载失败
            </div>
          ) : listQuery.data.items.length === 0 ? (
            <div className='px-4 py-10 text-center text-[11px] font-mono uppercase tracking-widest text-muted-foreground'>
              [ 暂无通知 ]
            </div>
          ) : (
            <ul>
              {listQuery.data.items.map((notification) => {
                const isUnread =
                  !notification.read_at && !locallyRead.has(notification.id)
                return (
                  <li key={notification.id}>
                    <button
                      type='button'
                      onClick={() => handleRead(notification)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                        isUnread && 'bg-muted/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0',
                          isUnread ? 'bg-primary' : 'bg-transparent',
                        )}
                        aria-hidden='true'
                      />
                      <span className='min-w-0 flex-1'>
                        <span
                          className={cn(
                            'block text-sm leading-snug',
                            !isUnread && 'text-muted-foreground',
                          )}
                        >
                          {notification.title}
                        </span>
                        <span className='mt-0.5 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70'>
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

        <div className='border-t border-border p-2'>
          <Button
            variant='outline'
            size='sm'
            className='w-full'
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
