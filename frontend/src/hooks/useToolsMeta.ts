import { useContext, useEffect, useMemo } from 'react';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import { toolsConfig } from '../config/tools';
import type { ToolDefinition } from '../config/tools';
import { AuthContext } from '../context/AuthContext';
import { realtimeClient } from '../lib/realtime';

export interface ToolMetaOverride {
  tool_id: string;
  enabled: boolean;
  sort_order: number;
  custom_name: string | null;
  custom_description: string | null;
}

export const toolsMetaQueryKey = ['tools-meta'] as const;

export const toolsMetaQueryOptions = queryOptions({
  queryKey: toolsMetaQueryKey,
  queryFn: () =>
    api
      .get<ToolMetaOverride[]>('/tools-meta')
      .then((response) => response.data),
  staleTime: 5 * 60 * 1000,
  retry: 1,
});

function resolveVisibleTools(overrides: ToolMetaOverride[]) {
  const overrideMap = new Map(
    overrides.map((override) => [override.tool_id, override]),
  );
  const visibleTools: Array<ToolDefinition & { sortOrder: number }> = [];

  for (const [index, tool] of toolsConfig.entries()) {
    const override = overrideMap.get(tool.id);
    if (override?.enabled === false) continue;

    visibleTools.push({
      ...tool,
      name: override?.custom_name?.trim() || tool.name,
      description:
        override?.custom_description?.trim() || tool.description,
      sortOrder: override?.sort_order ?? index,
    });
  }

  return visibleTools.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 登录后全局订阅：tools_meta.updated → 失效缓存并 REST 重拉。 */
export function useToolsMetaRealtimeInvalidation() {
  const queryClient = useQueryClient();
  useEffect(() => {
    return realtimeClient.subscribe((event) => {
      if (event.type === 'tools_meta.updated') {
        void queryClient.invalidateQueries({ queryKey: toolsMetaQueryKey });
      }
    });
  }, [queryClient]);
}

export function useVisibleTools() {
  const { user } = useContext(AuthContext);
  // 后端 GET /tools-meta 要求 tool:use 权限；无权限用户不请求受保护端点，
  // 工具列表为空（主页显示空态提示）。
  const hasToolUse = user?.permissions.includes('tool:use') ?? false;

  const query = useQuery({
    ...toolsMetaQueryOptions,
    enabled: hasToolUse,
  });

  const visibleTools = useMemo(() => {
    if (!hasToolUse) return [];
    if (query.data) {
      return resolveVisibleTools(query.data);
    }
    if (query.isError) {
      return resolveVisibleTools([]);
    }
    return [];
  }, [query.data, query.isError, hasToolUse]);

  return {
    visibleTools,
    // 禁用的查询（无权限）不进入 pending，直接渲染空态
    isPending: hasToolUse ? query.isPending : false,
    /** 当前用户是否具备 tool:use 权限（用于主页空态文案区分） */
    hasAccess: hasToolUse,
  };
}
