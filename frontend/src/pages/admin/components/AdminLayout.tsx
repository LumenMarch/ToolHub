import { useContext, useEffect, useMemo } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ChartBar,
  ClipboardList,
  Home,
  LogOut,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react'

import { BrandMark } from '@/components/BrandMark'
import { NotificationBell } from '@/components/NotificationBell'
import { ThemeToggle } from '@/components/ThemeToggle'
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
  { to: '/admin/roles', label: '角色管理', icon: ShieldCheck, permission: 'role:read' },
] as const

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

  const isActive = (to: string) =>
    to === '/admin'
      ? location.pathname === '/admin'
      : location.pathname.startsWith(to)

  const currentItem =
    navItems.find((item) => isActive(item.to)) ?? navItems[0]

  useEffect(() => {
    document.title = pageTitle(currentItem?.label ?? '控制台')
    return () => {
      document.title = pageTitle()
    }
  }, [currentItem])

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      navigate('/login')
    }
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/admin">
                  <BrandMark />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const Icon = item.icon
                  const active = isActive(item.to)
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active}>
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
              <SidebarMenuButton asChild>
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
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <h1 className="min-w-0 truncate text-sm font-medium">
            {currentItem?.label ?? '控制台'}
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
        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default AdminLayout
