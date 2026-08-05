import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MonitorUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import PermissionGuard from '@/components/guards/PermissionGuard'
import { useAdminApi, type UserSession } from '../hooks/use-admin-api'
import { type User } from './schema'

/** 设备摘要：从 UA 提取浏览器 + 系统，无法识别时截断原文。 */
function summarizeUserAgent(ua: string | null) {
  if (!ua) return '未知设备'
  const browser = (() => {
    if (ua.includes('Edg/')) return 'Edge'
    if (ua.includes('Chrome/')) return 'Chrome'
    if (ua.includes('Firefox/')) return 'Firefox'
    if (ua.includes('Safari/')) return 'Safari'
    if (ua.includes('curl/')) return 'curl'
    return null
  })()
  // iOS 判断必须在 Mac OS 之前：iPhone/iPad UA 也含 "Mac OS X"
  const os = (() => {
    if (ua.includes('Windows')) return 'Windows'
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
    if (ua.includes('Mac OS')) return 'macOS'
    if (ua.includes('Android')) return 'Android'
    if (ua.includes('Linux')) return 'Linux'
    return null
  })()
  const parts = [browser, os].filter(Boolean) as string[]
  if (parts.length > 0) return parts.join(' · ')
  return ua.length > 24 ? `${ua.slice(0, 24)}…` : ua
}

/** 会话时间展示（沿用全站 server-wall-time 约定）。 */
function formatSessionDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 后端时间戳为无时区 UTC：补 Z 解析为真实时刻，供在线窗口比较（避免按本地时间误读产生偏移）。 */
function parseSessionTime(value: string | null) {
  if (!value) return Number.NaN
  const hasTimezone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value)
  return new Date(hasTimezone ? value : `${value}Z`).getTime()
}

/** 会话管理弹窗：查看用户登录会话列表，可强制下线未吊销会话。 */
export function UsersSessionsDialog({
  currentRow,
  open,
  onOpenChange,
}: {
  currentRow: User
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const api = useAdminApi()
  const queryClient = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<UserSession | null>(null)

  const sessionsQuery = useQuery({
    queryKey: ['user-sessions', currentRow.id],
    queryFn: () => api.listUserSessions(currentRow.id),
    enabled: open,
  })

  const revokeMutation = useMutation({
    mutationFn: (sessionId: number) =>
      api.revokeUserSession(currentRow.id, sessionId),
    onSuccess: () => {
      toast.success('已强制下线该会话')
      setRevokeTarget(null)
      void queryClient.invalidateQueries({
        queryKey: ['user-sessions', currentRow.id],
      })
    },
    onError: () => toast.error('强制下线失败'),
  })

  const sessions = sessionsQuery.data ?? []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader className='text-start'>
            <DialogTitle>登录会话</DialogTitle>
            <DialogDescription>
              用户{' '}
              <span className='font-mono font-bold text-foreground'>
                {currentRow.username}
              </span>{' '}
              的登录设备列表，可强制下线指定会话。
            </DialogDescription>
          </DialogHeader>

          <div className='max-h-80 space-y-2 overflow-y-auto'>
            {sessionsQuery.isPending ? (
              <div className='space-y-2'>
                <Skeleton className='h-16 w-full' />
                <Skeleton className='h-16 w-full' />
              </div>
            ) : sessionsQuery.isError ? (
              <p className='py-8 text-center text-[11px] font-mono uppercase tracking-widest text-destructive'>
                会话列表加载失败
              </p>
            ) : sessions.length === 0 ? (
              <p className='py-8 text-center text-[11px] font-mono uppercase tracking-widest text-muted-foreground'>
                [ 暂无会话 ]
              </p>
            ) : (
              sessions.map((session) => {
                const revoked = session.revoked_at !== null
                // 在线判定与后端契约一致：未吊销且最近活跃（last_seen 兜底 created）在 5 分钟内
                const lastActiveMs = parseSessionTime(
                  session.last_seen_at ?? session.created_at,
                )
                const online =
                  !revoked &&
                  !Number.isNaN(lastActiveMs) &&
                  Date.now() - lastActiveMs < 5 * 60 * 1000
                const statusText = revoked ? '已下线' : online ? '在线' : '离线'
                const statusClass = revoked
                  ? 'border border-status-danger-foreground/30 bg-status-danger-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-status-danger-foreground'
                  : online
                    ? 'border border-status-success-foreground/30 bg-status-success-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-status-success-foreground'
                    : 'border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground'
                return (
                  <div
                    key={session.id}
                    className='flex items-center gap-3 border border-border p-3'
                  >
                    <div className='min-w-0 flex-1 space-y-0.5'>
                      <div className='flex items-center gap-2'>
                        <MonitorUp className='size-4 shrink-0 text-muted-foreground' />
                        <span className='truncate text-sm font-medium'>
                          {summarizeUserAgent(session.user_agent)}
                        </span>
                        <span className={statusClass}>{statusText}</span>
                      </div>
                      <p className='font-mono text-[11px] text-muted-foreground'>
                        IP {session.ip ?? '—'} · 创建 {formatSessionDate(session.created_at)} · 最后活跃{' '}
                        {formatSessionDate(session.last_seen_at)}
                      </p>
                    </div>
                    <PermissionGuard permission='user:write'>
                      <Button
                        variant='outline'
                        size='sm'
                        className='shrink-0'
                        disabled={revoked || revokeMutation.isPending}
                        onClick={() => setRevokeTarget(session)}
                      >
                        强制下线
                      </Button>
                    </PermissionGuard>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(next) => {
          if (!next) setRevokeTarget(null)
        }}
        destructive
        isLoading={revokeMutation.isPending}
        handleConfirm={() => {
          if (revokeTarget) revokeMutation.mutate(revokeTarget.id)
        }}
        title={<span className='text-destructive'>强制下线</span>}
        desc={
          <p>
            确定要强制下线
            <span className='font-bold'>
              {' '}
              {revokeTarget
                ? summarizeUserAgent(revokeTarget.user_agent)
                : ''}
            </span>{' '}
            这个会话吗？该设备将立即被登出。
          </p>
        }
        confirmText='确认下线'
        cancelBtnText='取消'
      />
    </>
  )
}
