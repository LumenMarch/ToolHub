import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { toolsConfig } from '../config/tools';
import api from '../api/axios';

interface ToolMetaOverride {
  tool_id: string;
  enabled: boolean;
}

/**
 * 工具路由守卫 — 已禁用的工具重定向到首页。
 * 包裹在 ProtectedRoute 内部，仅对已登录用户生效。
 */
const ToolGuard: React.FC = () => {
  const location = useLocation();
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<ToolMetaOverride[]>('/tools-meta')
      .then((res) => {
        if (!active) return;
        const ids = new Set<string>();
        for (const item of res.data) {
          if (!item.enabled) ids.add(item.tool_id);
        }
        setDisabledIds(ids);
        setReady(true);
      })
      .catch(() => {
        if (!active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!ready) return <Outlet />;

  // 检查当前路径对应的工具是否被禁用
  const currentTool = toolsConfig.find(
    (t) =>
      location.pathname === t.path ||
      location.pathname.startsWith(`${t.path}/`),
  );

  if (currentTool && disabledIds.has(currentTool.id)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default ToolGuard;
