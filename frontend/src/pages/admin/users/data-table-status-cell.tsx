import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatAdminDate } from './data'
import { type User } from './schema'
import { useUsers } from './users-provider'

/**
 * 状态列单元格（可点击）：在线 → 绿点 +「在线」；离线 →「上次登录 {时间}」。
 * 整格点击打开会话弹窗（替代原独立"会话"按钮列）。
 */
export function DataTableStatusCell({ user }: { user: User }) {
  const { setOpen, setCurrentRow } = useUsers()

  const openSessions = () => {
    setCurrentRow(user)
    setOpen('sessions')
  }

  // 悬停提示：点击打开会话；有登录记录时附带"上次登录"（字段即 last_login_at 语义，
  // 与在线判定的 last_seen 区分，避免"在线但显示旧活跃时间"的文案矛盾）
  const tooltipText =
    user.online && user.last_login_at
      ? `点击查看登录会话 · 上次登录 ${formatAdminDate(user.last_login_at)}`
      : '点击查看登录会话'

  if (user.online) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            aria-label='查看登录会话'
            onClick={openSessions}
            className='flex w-full cursor-pointer items-center gap-1.5 hover:underline'
          >
            <span
              className='size-2 rounded-full bg-status-success-foreground'
              aria-hidden='true'
            />
            <span className='text-[11px] font-mono uppercase tracking-widest text-status-success-foreground'>
              在线
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    )
  }

  // 离线（含 online 字段未上线时缺省）：保留上次登录时间展示
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          aria-label='查看登录会话'
          onClick={openSessions}
          className='w-full cursor-pointer text-left font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-primary'
        >
          上次登录 {formatAdminDate(user.last_login_at)}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  )
}
