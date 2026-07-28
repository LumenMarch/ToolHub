import { useMemo } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import { toolsConfig } from '../config/tools';
import type { ToolDefinition } from '../config/tools';

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

export function useVisibleTools() {
  const query = useQuery(toolsMetaQueryOptions);
  const visibleTools = useMemo(() => {
    if (query.data) {
      return resolveVisibleTools(query.data);
    }
    if (query.isError) {
      return resolveVisibleTools([]);
    }
    return [];
  }, [query.data, query.isError]);

  return {
    visibleTools,
    isPending: query.isPending,
  };
}
