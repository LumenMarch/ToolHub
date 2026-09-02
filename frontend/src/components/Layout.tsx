import { useContext, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Shield } from 'lucide-react'

import { BrandMark } from '@/components/BrandMark'
import { NotificationBell } from '@/components/NotificationBell'
import { PageHeader } from '@/components/PageHeader'
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

  useEffect(() => {
    document.title = pageTitle(activeTool?.name)
    return () => {
      document.title = pageTitle()
    }
  }, [activeTool])

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
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="flex h-14 items-center gap-3 px-4">
          <Link to="/" className="shrink-0">
            <BrandMark />
          </Link>
          {isToolRoute && activeTool ? (
            <>
              <Separator orientation="vertical" className="hidden h-4 sm:block" />
              <span className="hidden truncate text-sm font-medium sm:inline">
                {activeTool.name}
              </span>
            </>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
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

      <main className="flex flex-1 flex-col">
        {isToolRoute ? (
          <div className="flex flex-1 flex-col gap-6 p-6">
            {activeTool ? (
              <PageHeader
                title={activeTool.name}
                description={activeTool.description}
              />
            ) : null}
            <Outlet />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-6">
            <Outlet />
          </div>
        )}
      </main>
    </div>
  )
}

export default Layout
