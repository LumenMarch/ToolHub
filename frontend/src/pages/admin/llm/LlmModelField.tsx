import React, { useCallback, useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import type { LlmProbeResult } from '../../../types/llm';
import { useAdminApi } from '../hooks/use-admin-api';

interface Props {
  id: string;
  value: string;
  /** env 默认模型名，作为输入框 placeholder */
  envDefault: string;
  onChange: (value: string) => void;
}

/** 名字不在服务端列表里：单模型 llama.cpp 会忽略 model 字段所以照样能跑，
 * 但这颗雷会在服务端挂第二个模型时炸，必须显式提醒而不是静默通过。 */
function isNotListed({
  loading,
  value,
  models,
}: {
  loading: boolean;
  value: string;
  models: string[];
}): boolean {
  return !loading && value.trim() !== '' && models.length > 0 && !models.includes(value);
}

interface ModelListProps {
  loading: boolean;
  error: string | null;
  models: string[];
  filtered: string[];
  selected: string;
  onPick: (name: string) => void;
}

/** 下拉面板正文：加载中 / 出错 / 空列表 / 列表，四态之一。 */
const ModelList: React.FC<ModelListProps> = ({
  loading,
  error,
  models,
  filtered,
  selected,
  onPick,
}) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
        <Spinner />
        正在读取服务端模型列表…
      </div>
    );
  }
  if (error) {
    return <div className="px-3 py-4 text-sm text-destructive">{error}</div>;
  }
  if (filtered.length === 0) {
    return (
      <CommandEmpty>{models.length ? '没有匹配的模型名' : '服务端未返回模型列表'}</CommandEmpty>
    );
  }
  return (
    <CommandGroup heading={`服务端模型（${models.length}）`}>
      {filtered.map((name) => (
        <CommandItem
          key={name}
          value={name}
          onSelect={() => onPick(name)}
          className="font-mono text-xs"
        >
          <Check className={name === selected ? 'opacity-100' : 'opacity-0'} />
          {name}
        </CommandItem>
      ))}
    </CommandGroup>
  );
};

/**
 * 模型名选择器：可手输 + 从服务端模型列表里挑。
 *
 * 为什么两边都要：
 * - 只让手输，就会撞上实测那个坑 —— 配置里写别名、服务端实际挂的是 gguf
 *   绝对路径，llama.cpp 单模型时忽略 model 字段所以"看起来能用"，挂第二个
 *   模型立刻 404；
 * - 只让下拉，就堵死了 vLLM 多模型别名、以及服务端 /v1/models 不可用时
 *   仍然需要手填救急的场景。
 *
 * 列表只在面板打开时探活获取，不在页面加载时打 —— 探活是要走上游的。
 */
export const LlmModelField: React.FC<Props> = ({ id, value, envDefault, onChange }) => {
  const api = useAdminApi();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api
      .probeLlm()
      .then((result: LlmProbeResult) => {
        setModels(result.models);
        setError(result.error ?? (result.reachable ? null : '服务不可达'));
      })
      .catch(() => setError('探活请求失败'))
      .finally(() => setLoading(false));
  }, [api]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      // 打开面板即拉一次：模型列表跟着服务端实际挂载走，缓存反而容易误导
      if (next) load();
    },
    [load],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((name) => name.toLowerCase().includes(needle));
  }, [models, query]);

  const notListed = isNotListed({ loading, value, models });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          placeholder={envDefault || '未设置'}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono text-xs"
        />
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" aria-label="从服务端模型列表选择">
              {loading ? <Spinner /> : <ChevronsUpDown />}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={4}
            // 不能用 --radix-popover-trigger-width：触发器是那个图标按钮，
            // 用它会得到一个 40px 宽、每行只装得下一个字的下拉面板
            className="w-[min(420px,calc(100vw-2rem))] p-0"
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="搜索模型名"
                value={query}
                onValueChange={setQuery}
              />
              <CommandList>
                <ModelList
                  loading={loading}
                  error={error}
                  models={models}
                  filtered={filtered}
                  selected={value}
                  onPick={(name) => {
                    onChange(name);
                    setOpen(false);
                  }}
                />
              </CommandList>
              {!loading && !error ? (
                <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                  列表来自<strong>已保存</strong>的服务地址；改了地址请先保存。
                </div>
              ) : null}
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {notListed ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          这个名字不在服务端模型列表里：单模型 llama.cpp 会忽略它所以照样能跑，
          挂第二个模型就 404。建议从列表选，或给服务端加 --alias。
        </p>
      ) : null}
    </div>
  );
};
