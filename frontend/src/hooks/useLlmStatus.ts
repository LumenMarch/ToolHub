import { useEffect } from 'react';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import { realtimeClient } from '../lib/realtime';
import type { LlmStatus } from '../types/llm';

export const llmStatusQueryKey = ['llm-status'] as const;

/**
 * 模型服务可用性。
 *
 * staleTime 取 30 秒：状态里带探活，探活在后端按 TTL 复用，但前端也没必要
 * 每次挂载都打一次 —— 工具页来回切换时这份数据基本不变。
 */
export const llmStatusQueryOptions = queryOptions({
  queryKey: llmStatusQueryKey,
  queryFn: () => api.get<LlmStatus>('/llm/status').then((r) => r.data),
  staleTime: 30 * 1000,
  retry: 1,
});

export function useLlmStatus() {
  return useQuery(llmStatusQueryOptions);
}

/** 管理员改完模型配置后，所有在线的工具页应立即重估按钮状态。 */
export function useLlmStatusRealtimeInvalidation() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if (event.type === 'llm_config.updated') {
          void queryClient.invalidateQueries({ queryKey: llmStatusQueryKey });
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
export function llmUnavailableReason(status: LlmStatus | undefined): string | null {
  if (!status) return '正在确认模型服务状态…';
  if (!status.enabled) return '模型服务已被管理员关闭，请联系管理员';
  if (!status.configured) return '模型服务未配置（缺少服务地址或模型名），请联系管理员';
  if (status.cooldownActive) return '模型服务连续失败进入冷却，请稍后重试';
  if (status.lastProbe && !status.lastProbe.ok) {
    return `模型服务当前不可用：${status.lastProbe.error ?? '连接失败'}`;
  }
  return null;
}
