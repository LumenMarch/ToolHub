import React, { useContext, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import RouteLoadingState from './RouteLoadingState';

const ProtectedRoute: React.FC = () => {
  const { user, isLoading, logout } = useContext(AuthContext);
  const location = useLocation();

  // 被拒用户若还持有会话（如整页刷新后 /users/me 返回 rejected），
  // 先本地登出再跳登录页，避免 Login 的"已登录跳回 /"造成重定向循环。
  useEffect(() => {
    if (user?.status === 'rejected') {
      void logout();
    }
  }, [user, logout]);

  if (isLoading) {
    return <RouteLoadingState />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // 被拒用户：跳登录页（后端登录会返回区分文案）
  if (user.status === 'rejected') {
    return <Navigate to="/login" replace />;
  }

  // 注册待审批用户：只能看到待审页，不能进入工具/主站（已在 /pending 时正常渲染）
  if (user.status === 'pending' && location.pathname !== '/pending') {
    return <Navigate to="/pending" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
