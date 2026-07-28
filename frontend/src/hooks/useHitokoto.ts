import { queryOptions, useQuery } from '@tanstack/react-query';
import api from '../api/axios';

const FALLBACK_HITOKOTO = '落霞与孤鹜齐飞，秋水共长天一色。';

interface HitokotoState {
  text: string | null;
  loading: boolean;
}

const hitokotoQueryOptions = queryOptions({
  queryKey: ['hitokoto'],
  queryFn: () =>
    api
      .get<{ hitokoto: string }>('/tools/sixty-seconds/hitokoto')
      .then((response) => response.data?.hitokoto?.trim() || FALLBACK_HITOKOTO),
  staleTime: Infinity,
  retry: 1,
});

export function useHitokoto(): HitokotoState {
  const query = useQuery(hitokotoQueryOptions);
  return {
    text: query.data ?? (query.isError ? FALLBACK_HITOKOTO : null),
    loading: query.isPending,
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
