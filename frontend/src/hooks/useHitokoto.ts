import { useEffect, useState } from 'react';
import api from '../api/axios';

// 后端调用失败时的兜底句，保证页面始终有内容。
const FALLBACK_HITOKOTO = '落霞与孤鹜齐飞，秋水共长天一色。';

interface HitokotoState {
  text: string;
  loading: boolean;
}

/**
 * 拉取每日一言。每次组件挂载都会获取一条新句，失败时回退到兜底句。
 */
export function useHitokoto(): HitokotoState {
  const [state, setState] = useState<HitokotoState>({
    text: FALLBACK_HITOKOTO,
    loading: true,
  });

  useEffect(() => {
    let active = true;

    api
      .get<{ hitokoto: string }>('/tools/sixty-seconds/hitokoto')
      .then((response) => {
        if (!active) return;
        const hitokoto = response.data?.hitokoto?.trim();
        setState({ text: hitokoto || FALLBACK_HITOKOTO, loading: false });
      })
      .catch(() => {
        if (!active) return;
        setState({ text: FALLBACK_HITOKOTO, loading: false });
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
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
