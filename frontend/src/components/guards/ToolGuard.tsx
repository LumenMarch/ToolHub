import React from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { useVisibleTools } from '../../hooks/useToolsMeta';
import RouteLoadingState from './RouteLoadingState';

/**
 * 工具路由守卫 — 已禁用的工具重定向到首页。
 * 包裹在 ProtectedRoute 内部，仅对已登录用户生效。
 */
const ToolGuard: React.FC = () => {
  const location = useLocation();
  const { visibleTools, isPending } = useVisibleTools();

  if (isPending) {
    return (
      <RouteLoadingState
        fullScreen={false}
        label="[ 工具 · 校验中 ]"
        detail="等待元数据"
        meta="Tools / Access"
      />
    );
  }

  const currentToolEnabled = visibleTools.some(
    (tool) =>
      location.pathname === tool.path ||
      location.pathname.startsWith(`${tool.path}/`),
  );

  if (!currentToolEnabled) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default ToolGuard;
