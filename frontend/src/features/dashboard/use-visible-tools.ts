import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getToolMeta } from '../../api/tools'
import type { ToolMetaOverride } from '../../api/types'
import { useAuth } from '../auth/auth-context'
import { TOOL_CATALOG } from './tool-catalog'
import type { ToolDefinition } from './tool-catalog'

export const toolsMetaQueryKey = ['tools-meta'] as const

export interface VisibleTool extends ToolDefinition {
  name: string
  description: string
  sortOrder: number
}

export function useVisibleTools() {
  const { user } = useAuth()
  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions])

  const hasAnyToolPermission = useMemo(
    () =>
      [...permissions].some(
        (permission) => permission.startsWith('tool:') && permission.endsWith(':use'),
      ),
    [permissions],
  )

  const metaQuery = useQuery({
    queryKey: toolsMetaQueryKey,
    queryFn: getToolMeta,
    enabled: Boolean(user) && hasAnyToolPermission,
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const tools = useMemo<VisibleTool[]>(() => {
    if (!user) return []
    const overrides = new Map<string, ToolMetaOverride>(
      (metaQuery.data ?? []).map((override) => [override.tool_id, override]),
    )

    const visible: VisibleTool[] = []
    TOOL_CATALOG.forEach((tool, index) => {
      if (!permissions.has(tool.permission)) return
      const override = overrides.get(tool.id)
      if (override?.enabled === false) return
      visible.push({
        ...tool,
        name: override?.custom_name?.trim() || tool.name,
        description: override?.custom_description?.trim() || tool.description,
        sortOrder: override?.sort_order ?? index,
      })
    })
    visible.sort((left, right) => left.sortOrder - right.sortOrder)
    return visible
  }, [metaQuery.data, permissions, user])

  return {
    tools,
    hasAnyToolPermission,
    isLoading: Boolean(user) && hasAnyToolPermission && metaQuery.isPending,
    isError: metaQuery.isError,
    refetch: metaQuery.refetch,
  }
}
