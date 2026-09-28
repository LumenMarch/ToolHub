import { useContext, useEffect, useMemo } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ChartBar,
  ClipboardList,
  Cpu,
  Home,
  LogOut,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react'

import { BrandMark } from '@/components/BrandMark'
import { NotificationBell } from '@/components/NotificationBell'
import { ThemeToggle } from '@/components/ThemeToggle'
import { SkipLink } from '@/components/SkipLink'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AuthContext } from '@/context/AuthContext'
import { pageTitle } from '@/lib/title'
import { usePendingApprovalCount } from '../hooks/use-pending-approval-count'

const ALL_NAV_ITEMS = [
  { to: '/admin', label: '概览', icon: ChartBar, permission: 'stats:read' },
  { to: '/admin/users', label: '用户', icon: Users, permission: 'user:read' },
  { to: '/admin/audit', label: '审计日志', icon: ScrollText, permission: 'audit:read' },
  { to: '/admin/tools', label: '工具', icon: ClipboardList, permission: 'tool_meta:read' },
  { to: '/admin/llm', label: '模型服务', icon: Cpu, permission: 'llm_config:read' },
  { to: '/admin/roles', label: '角色管理', icon: ShieldCheck, permission: 'role:read' },
] as const

// SidebarProvider 只写 sidebar_state cookie、从不读它（shadcn 假设 SSR 侧读取，
// 纯 SPA 里永远走 defaultOpen=true）。客户端自读一次，收起状态才能跨 reload 保留。
function sidebarDefaultOpen(): boolean {
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/)
  return match ? match[1] === 'true' : true
}

const AdminLayout: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useContext(AuthContext)
  const pendingCount = usePendingApprovalCount()

  const navItems = useMemo(
    () =>
      ALL_NAV_ITEMS.filter((item) => user?.permissions.includes(item.permission)),
    [user],
  )

  // 标签按静态路由表取，而非权限过滤后的导航项：无权限的路由页面仍会渲染，
  // 只有不在路由表中的路径才是「页面不存在」
  const currentLabel =
    ALL_NAV_ITEMS.find((item) => item.to === location.pathname)?.label ?? '页面不存在'

  useEffect(() => {
    document.title = pageTitle(currentLabel)
    return () => {
      document.title = pageTitle()
    }
  }, [currentLabel])

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      navigate('/login')
    }
  }

  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen()}>
      {/* icon 模式：收起后保留 3rem 图标栏，而不是整块滑出视口 */}
      <Sidebar collapsible="icon">
        <SidebarHeader className="flex-row items-center justify-between gap-2">
          {/* 纯标识（标题），不做可点控件：/admin 由「概览」导航项进入 */}
          <div className="min-w-0 flex-1 truncate px-2 py-1 text-sm group-data-[collapsible=icon]:hidden">
            <BrandMark />
          </div>
          {/* 折叠按钮放侧边栏这边：展开时居品牌行右端，收起时独占图标栏顶部。
              移动端另在顶栏保留入口（抽屉收起时侧栏不可见）。 */}
          <SidebarTrigger className="hidden shrink-0 md:inline-flex group-data-[collapsible=icon]:mx-auto" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const Icon = item.icon
                  const active = location.pathname === item.to
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link to={item.to}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.to === '/admin/users' && pendingCount > 0 ? (
                        <SidebarMenuBadge>{pendingCount}</SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="返回主站">
                <Link to="/">
                  <Home />
                  <span>返回主站</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SkipLink targetId="admin-content" />
          <SidebarTrigger className="md:hidden" />
          <Separator orientation="vertical" className="mr-2 h-4 md:hidden" />
          <h1 className="min-w-0 truncate text-sm font-medium">
            {currentLabel}
          </h1>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            {user?.username ? (
              <span className="hidden px-2 text-sm text-muted-foreground lg:inline">
                {user.username}
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void handleLogout()}>
              <LogOut data-icon="inline-start" />
              退出
            </Button>
          </div>
        </header>
        <div id="admin-content" className="flex-1 p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default AdminLayout
