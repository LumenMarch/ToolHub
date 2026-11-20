import { Button, Result } from 'antd'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/auth-context'
import { usePermission } from '../../features/auth/use-permission'
import { RouteFallback } from '../components/route-fallback'

export function RequireAdmin() {
  const { user, isLoading } = useAuth()
  const { isAdmin } = usePermission()
  const navigate = useNavigate()

  if (isLoading) return <RouteFallback />
  if (!user) return <Navigate to="/login" replace />
  if (user.status === 'pending') return <Navigate to="/pending" replace />
  if (!isAdmin) {
    return (
      <Result
        status="403"
        title="没有管理权限"
        subTitle="当前账号没有进入管理控制台的权限。"
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            返回工作台
          </Button>
        }
      />
    )
  }
  return <Outlet />
}
