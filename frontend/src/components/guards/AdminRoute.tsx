import React, { useContext } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
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

  // 有任意管理相关权限即可进入控制台
  const hasAdminAccess = user.permissions.some((p) =>
    p !== 'tool:use',
  );

  if (!hasAdminAccess) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default AdminRoute;
