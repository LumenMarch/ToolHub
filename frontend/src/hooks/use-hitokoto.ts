import { queryOptions, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import api from '../api/axios';

/** 后端 /tools/sixty-seconds/hitokoto 的响应模型。 */
export type HitokotoSource = 'local' | 'remote' | 'fallback';

interface HitokotoResponse {
  hitokoto: string;
  source: HitokotoSource;
}

interface HitokotoState {
  text: string | null;
  /** 内容来源：内置数据 / 远程 API / 硬编码兜底句；加载失败时为 null */
  source: HitokotoSource | null;
  loading: boolean;
  /** 后端/API 不可用（网络错误、网关 5xx、探测失败，或内容源降级为兜底句） */
  unreachable: boolean;
  error: boolean;
}

/** 判断请求失败是否表示后端/API 不可达，供登录页探测与提交共用。 */
export function isBackendUnreachable(err: unknown): boolean {
  if (!axios.isAxiosError(err)) {
    // 非 axios 异常（如空响应抛错）对登录探测同样视为不可用
    return true;
  }
  if (!err.response || err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') {
    return true;
  }
  const status = err.response.status;
  // 开发代理/反向代理在上游挂掉时常返回 502/503/504
  return status === 502 || status === 503 || status === 504;
}

const hitokotoQueryOptions = queryOptions({
  queryKey: ['hitokoto'],
  queryFn: () =>
    api
      .get<HitokotoResponse>('/tools/sixty-seconds/hitokoto')
      .then((response) => {
        const text = response.data?.hitokoto?.trim();
        if (!text) {
          throw new Error('每日一言响应为空');
        }
        // 来源随文本一起返回：探活语义与展示内容解耦
        return { text, source: response.data.source };
      }),
  staleTime: (query) => (query.state.data?.source === 'fallback' ? 0 : Infinity),
  retry: 1,
});

export function useHitokoto(): HitokotoState {
  const query = useQuery(hitokotoQueryOptions);
  // 登录页用 hitokoto 作 API 探活：请求失败，或内容源已降级为硬编码兜底句时，都视为服务不可用
  const isUnreachable = Boolean(query.isError) || query.data?.source === 'fallback';

  return {
    text: query.data?.text ?? null,
    source: query.data?.source ?? null,
    loading: query.isPending,
    unreachable: isUnreachable,
    error: query.isError,
  };
}

/**
 * 将一段文本按字符数尽量均分为 N 行，供切片动画逐行渲染。
 * 长度不足以切分时返回按自然断句的子串数组。
 */
export function splitIntoLines(text: string, lines = 3): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [''];

  // 文本很短时直接按实际切，避免出现空行。
  if (trimmed.length <= lines) {
    return Array.from({ length: lines }, (_, i) => trimmed[i] ?? '');
  }

  const chunkSize = Math.ceil(trimmed.length / lines);
  const result: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    result.push(trimmed.slice(i * chunkSize, (i + 1) * chunkSize));
  }
  // 合并末尾可能因取整产生的空串。
  return result.filter((line) => line.length > 0);
}
