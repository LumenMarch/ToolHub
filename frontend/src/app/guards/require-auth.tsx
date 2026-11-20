import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/auth-context'
import { RouteFallback } from '../components/route-fallback'

export function RequireAuth() {
  const { user, isLoading, logout } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (user?.status === 'rejected') {
      void logout()
    }
  }, [logout, user?.status])

  if (isLoading) return <RouteFallback />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.status === 'rejected') return <Navigate to="/login" replace />
  if (user.status === 'pending' && location.pathname !== '/pending') {
    return <Navigate to="/pending" replace />
  }
  return <Outlet />
}
