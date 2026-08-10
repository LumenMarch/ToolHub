import React, { useContext } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { ADMIN_PERMISSIONS } from '../../hooks/use-permission';
import RouteLoadingState from './RouteLoadingState';

const AdminRoute: React.FC = () => {
  const { user, isLoading } = useContext(AuthContext);

  if (isLoading) {
    return <RouteLoadingState />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // 待审批用户不能进入控制台
  if (user.status === 'pending') {
    return <Navigate to="/pending" replace />;
  }

  // 持有任一管理权限（白名单）即可进入控制台
  const hasAdminAccess = user.permissions.some((p) =>
    ADMIN_PERMISSIONS.includes(p),
  );

  if (!hasAdminAccess) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default AdminRoute;
