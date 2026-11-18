import { useEffect } from 'react';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import { realtimeClient } from '../lib/realtime';
import type { LlmAvailability, LlmStatus } from '../types/llm';

export const llmStatusQueryKey = ['llm-status'] as const;
export const llmAvailabilityQueryKey = ['llm-availability'] as const;

/**
 * 工具页可用性门控。
 *
 * 只读最小字段，不触发上游探活；完整状态（探活、队列、指标）仅管理员可读。
 */
export const llmAvailabilityQueryOptions = queryOptions({
  queryKey: llmAvailabilityQueryKey,
  queryFn: () => api.get<LlmAvailability>('/llm/availability').then((r) => r.data),
  staleTime: 30 * 1000,
  retry: 1,
});

/**
 * 管理台完整状态。
 *
 * staleTime 取 30 秒：状态里带探活，探活在后端按 TTL 复用，但前端也没必要
 * 每次挂载都打一次 —— 工具页来回切换时这份数据基本不变。
 */
export function llmStatusQueryOptions(probe = false) {
  return queryOptions({
    queryKey: llmStatusQueryKey,
    queryFn: () =>
      api
        .get<LlmStatus>('/llm/status', {
          params: probe ? { probe: true } : undefined,
        })
        .then((r) => r.data),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/** 状态页在前台时的刷新间隔；标签页隐藏后由 React Query 自动暂停。 */
export const LLM_STATUS_REFETCH_INTERVAL_MS = 60 * 1000;

export function useLlmAvailability() {
  return useQuery(llmAvailabilityQueryOptions);
}

/**
 * 管理台状态查询。
 *
 * - probe=true：请求带 `?probe=true` 的软探活，后端仍按 TTL 复用，不会每次
 *   打开页面都打上游；仅持有 llm_config:write 的调用方应开启。
 * - poll=true：页面可见且处于前台时每 60 秒刷新一次；后台标签页不轮询。
 *
 * 不使用 `/admin/llm/probe`（force=true）：那是手动“测试连接”的强制探活，
 * 会绕过 TTL 并受 6 次/分钟限流，不适合页面自动触发。
 */
export function useLlmStatus(
  { probe = false, poll = false }: { probe?: boolean; poll?: boolean } = {},
) {
  return useQuery({
    ...llmStatusQueryOptions(probe),
    // 每次进入页面都取一次；探活是否真的打到上游由网关 TTL 决定。
    refetchOnMount: probe ? 'always' : true,
    refetchInterval: poll ? LLM_STATUS_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
}

/** 管理员改完模型配置后，所有在线的工具页应立即重估按钮状态。 */
export function useLlmStatusRealtimeInvalidation() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if (event.type === 'llm_config.updated') {
          void queryClient.invalidateQueries({ queryKey: llmStatusQueryKey });
          void queryClient.invalidateQueries({ queryKey: llmAvailabilityQueryKey });
        }
      }),
    [queryClient],
  );
}

/**
 * 按钮不可用时的提示文案。
 *
 * 顺序有讲究：先看总开关，再看是否配置，再看熔断 —— 与后端错误的判定顺序一致，
 * 保证「界面上说的原因」和「点下去之后返回的原因」是同一件事。
 */
export function llmUnavailableReason(
  status: LlmAvailability | LlmStatus | undefined,
): string | null {
  if (!status) return '正在确认模型服务状态…';
  if (!status.enabled) return '模型服务已被管理员关闭，请联系管理员';
  if (!status.configured) return '模型服务未配置（缺少服务地址或模型名），请联系管理员';
  if (status.cooldownActive) return '模型服务连续失败进入冷却，请稍后重试';
  const lastProbe = 'lastProbe' in status ? status.lastProbe : null;
  if (lastProbe && !lastProbe.ok) {
    return `模型服务当前不可用：${lastProbe.error ?? '连接失败'}`;
  }
  if (!status.available) {
    return `模型服务当前不可用：${status.lastError ?? '连接失败'}`;
  }
  return null;
}
