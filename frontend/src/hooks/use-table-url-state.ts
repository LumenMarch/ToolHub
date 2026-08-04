import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table'

/**
 * 把表格的分页 / 列筛选（含搜索）状态同步到 URL 查询参数，
 * 支持刷新与分享链接。基于 React Router v7 的 useSearchParams 实现。
 *
 * 约定：
 * - 分页：page（1 基）、pageSize，缺省值时不出现在 URL；
 * - 列筛选：string 型用单个查询参数，array 型用重复查询参数（status=a&status=b）。
 */

type ColumnFilterConfig = {
  columnId: string
  searchKey: string
  type?: 'string' | 'array'
  serialize?: (value: unknown) => unknown
  deserialize?: (value: unknown) => unknown
}

type UseTableUrlStateParams = {
  pagination?: {
    pageKey?: string
    pageSizeKey?: string
    defaultPage?: number
    defaultPageSize?: number
  }
  globalFilter?: {
    enabled?: boolean
    key?: string
    trim?: boolean
  }
  columnFilters?: ColumnFilterConfig[]
}

type UseTableUrlStateReturn = {
  globalFilter?: string
  onGlobalFilterChange?: OnChangeFn<string>
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
  pagination: PaginationState
  onPaginationChange: OnChangeFn<PaginationState>
  ensurePageInRange: (
    pageCount: number,
    opts?: { resetTo?: 'first' | 'last' }
  ) => void
}

/**
 * 更新 URL 查询参数：null/undefined 删除该键，数组重复追加。
 */
function applyParamPatch(
  prev: URLSearchParams,
  patch: Record<string, string | string[] | null | undefined>
): URLSearchParams {
  const next = new URLSearchParams(prev)
  for (const [key, value] of Object.entries(patch)) {
    next.delete(key)
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) next.append(key, item)
    } else {
      next.set(key, value)
    }
  }
  return next
}

export function useTableUrlState(
  params: UseTableUrlStateParams
): UseTableUrlStateReturn {
  const [searchParams, setSearchParams] = useSearchParams()

  const {
    pagination: paginationCfg,
    globalFilter: globalFilterCfg,
    columnFilters: columnFiltersCfg = [],
  } = params

  const pageKey = paginationCfg?.pageKey ?? 'page'
  const pageSizeKey = paginationCfg?.pageSizeKey ?? 'pageSize'
  const defaultPage = paginationCfg?.defaultPage ?? 1
  const defaultPageSize = paginationCfg?.defaultPageSize ?? 10

  const globalFilterKey = globalFilterCfg?.key ?? 'filter'
  const globalFilterEnabled = globalFilterCfg?.enabled ?? true
  const trimGlobal = globalFilterCfg?.trim ?? true

  // 初始列筛选：从 URL 读取（string 单值 / array 重复参数）
  const initialColumnFilters: ColumnFiltersState = useMemo(() => {
    const collected: ColumnFiltersState = []
    for (const cfg of columnFiltersCfg) {
      const deserialize = cfg.deserialize ?? ((v: unknown) => v)
      if (cfg.type === 'string') {
        const raw = searchParams.get(cfg.searchKey)
        const value = (deserialize(raw) as string) ?? ''
        if (typeof value === 'string' && value.trim() !== '') {
          collected.push({ id: cfg.columnId, value })
        }
      } else {
        const raw = searchParams.getAll(cfg.searchKey)
        const value = (deserialize(raw) as unknown[]) ?? []
        if (Array.isArray(value) && value.length > 0) {
          collected.push({ id: cfg.columnId, value })
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅初始化一次
    return collected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [columnFilters, setColumnFilters] =
    useState<ColumnFiltersState>(initialColumnFilters)

  // 分页直接由 URL 派生（浏览器前进/后退也能跟随）；page/pageSize 均做有限性校验与钳制
  const pagination: PaginationState = useMemo(() => {
    const rawPage = searchParams.get(pageKey)
    const rawPageSize = searchParams.get(pageSizeKey)
    const pageNum = rawPage ? Number.parseInt(rawPage, 10) : defaultPage
    const pageSizeNum = rawPageSize
      ? Number.parseInt(rawPageSize, 10)
      : defaultPageSize
    const safePage = Number.isFinite(pageNum) ? pageNum : defaultPage
    const safePageSize = Number.isFinite(pageSizeNum)
      ? pageSizeNum
      : defaultPageSize
    return {
      pageIndex: Math.max(0, Math.min(safePage, 10000) - 1),
      // 每页条数钳制在 [1, 100]
      pageSize: Math.max(1, Math.min(safePageSize, 100)),
    }
  }, [searchParams, pageKey, pageSizeKey, defaultPage, defaultPageSize])

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater(pagination) : updater
    const nextPage = next.pageIndex + 1
    const nextPageSize = next.pageSize
    setSearchParams(
      (prev) =>
        applyParamPatch(prev, {
          [pageKey]: nextPage !== defaultPage ? String(nextPage) : null,
          [pageSizeKey]:
            nextPageSize !== defaultPageSize ? String(nextPageSize) : null,
        }),
      { replace: false }
    )
  }

  const [globalFilter, setGlobalFilter] = useState<string | undefined>(() => {
    if (!globalFilterEnabled) return undefined
    return searchParams.get(globalFilterKey) ?? ''
  })

  const onGlobalFilterChange: OnChangeFn<string> | undefined =
    globalFilterEnabled
      ? (updater) => {
          const next =
            typeof updater === 'function'
              ? updater(globalFilter ?? '')
              : updater
          // 输入过程保留原始值，序列化进 URL 时才 trim，避免逐键跳变
          setGlobalFilter(next)
          const value = trimGlobal ? next.trim() : next
          setSearchParams(
            (prev) =>
              applyParamPatch(prev, {
                [pageKey]: null, // 搜索时回到第一页
                [globalFilterKey]: value ? value : null,
              }),
            { replace: false }
          )
        }
      : undefined

  const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    const next =
      typeof updater === 'function' ? updater(columnFilters) : updater
    setColumnFilters(next)

    // 一次构建 id → filter 映射，避免循环内 find
    const nextFilterMap = new Map(next.map((f) => [f.id, f]))
    const patch: Record<string, string | string[] | null> = {}

    for (const cfg of columnFiltersCfg) {
      const found = nextFilterMap.get(cfg.columnId)
      const serialize = cfg.serialize ?? ((v: unknown) => v)
      if (cfg.type === 'string') {
        const value =
          typeof found?.value === 'string' ? (found.value as string) : ''
        const serialized = serialize(value)
        patch[cfg.searchKey] =
          value.trim() !== '' ? String(serialized) : null
      } else {
        const value = Array.isArray(found?.value)
          ? (found.value as unknown[])
          : []
        const serialized = serialize(value)
        patch[cfg.searchKey] =
          Array.isArray(serialized) && serialized.length > 0
            ? (serialized as string[])
            : null
      }
    }

    setSearchParams(
      (prev) => applyParamPatch(prev, { [pageKey]: null, ...patch }),
      { replace: false }
    )
  }

  const ensurePageInRange = useCallback(
    (
      pageCount: number,
      opts: { resetTo?: 'first' | 'last' } = { resetTo: 'first' }
    ) => {
      const rawPage = searchParams.get(pageKey)
      const pageNum = rawPage ? Number.parseInt(rawPage, 10) : defaultPage
      if (pageCount > 0 && pageNum > pageCount) {
        setSearchParams(
          (prev) =>
            applyParamPatch(prev, {
              [pageKey]:
                opts.resetTo === 'last' ? String(pageCount) : null,
            }),
          { replace: true }
        )
      }
    },
    [searchParams, pageKey, defaultPage, setSearchParams]
  )

  return {
    globalFilter: globalFilterEnabled ? (globalFilter ?? '') : undefined,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  }
}
