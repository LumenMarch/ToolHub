import React from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { useVisibleTools } from '../../hooks/useToolsMeta';

/**
 * 工具路由守卫 — 已禁用的工具重定向到首页。
 * 包裹在 ProtectedRoute 内部，仅对已登录用户生效。
 */
const ToolGuard: React.FC = () => {
  const location = useLocation();
  const { visibleTools, isPending } = useVisibleTools();

  if (isPending) {
    return (
      <div
        role="status"
        aria-label="正在验证工具状态"
        className="flex min-h-[40vh] items-center justify-center"
      >
        <span className="size-5 animate-spin rounded-full border-[1.5px] border-border border-t-foreground" />
      </div>
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
