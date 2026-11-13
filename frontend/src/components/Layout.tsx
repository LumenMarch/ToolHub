import { useContext, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Shield } from 'lucide-react'

import { BrandMark } from '@/components/BrandMark'
import { NotificationBell } from '@/components/NotificationBell'
import { PageHeader } from '@/components/PageHeader'
import { SkipLink } from '@/components/SkipLink'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { toolsConfig } from '@/config/tools'
import { AuthContext } from '@/context/AuthContext'
import { ADMIN_PERMISSIONS } from '@/hooks/use-permission'
import { useVisibleTools } from '@/hooks/useToolsMeta'
import { pageTitle } from '@/lib/title'

const Layout: React.FC = () => {
  const { user, logout } = useContext(AuthContext)
  const navigate = useNavigate()
  const location = useLocation()
  const { visibleTools } = useVisibleTools()

  const activeTool = visibleTools.find(
    (tool) =>
      location.pathname === tool.path ||
      location.pathname.startsWith(`${tool.path}/`),
  )
  const isToolRoute = toolsConfig.some(
    (tool) =>
      location.pathname === tool.path ||
      location.pathname.startsWith(`${tool.path}/`),
  )

  const isDashboard = location.pathname === '/'

  useEffect(() => {
    // 未知路由（star 路由渲染 NotFound）时标题给出明确提示
    document.title = pageTitle(
      activeTool?.name ?? (isDashboard ? undefined : '页面不存在'),
    )
    return () => {
      document.title = pageTitle()
    }
  }, [activeTool, isDashboard])

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      navigate('/login')
    }
  }

  const canOpenAdmin = Boolean(
    user?.permissions.some((permission) => ADMIN_PERMISSIONS.includes(permission)),
  )

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-background/95 backdrop-blur-sm">
        <SkipLink targetId="main-content" />
        <div className="mx-auto flex h-12 w-full max-w-[var(--ds-content-max)] items-center gap-2.5 px-3 sm:px-6">
          <Link to="/" className="shrink-0" aria-label="返回工具台">
            <BrandMark />
          </Link>
          {isToolRoute && activeTool ? (
            <>
              <Separator orientation="vertical" className="hidden h-3.5 sm:block" />
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                {activeTool.name}
              </span>
            </>
          ) : null}
          <div className="ml-auto flex items-center gap-0.5">
            <ThemeToggle />
            <NotificationBell />
            {user?.username ? (
              <span className="hidden px-2 text-sm text-muted-foreground lg:inline">
                {user.username}
              </span>
            ) : null}
            {canOpenAdmin ? (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin">
                  <Shield data-icon="inline-start" />
                  控制台
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void handleLogout()}>
              <LogOut data-icon="inline-start" />
              退出
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-[var(--ds-content-max)] flex-1 flex-col gap-5 p-4 sm:p-6">
          {isToolRoute ? (
            <>
              {activeTool ? (
                <PageHeader
                  title={activeTool.name}
                  description={activeTool.description}
                />
              ) : null}
              <Outlet />
            </>
          ) : (
            <Outlet />
          )}
        </div>
      </main>
    </div>
  )
}

export default Layout
