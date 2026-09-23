import React, { useCallback, useState } from 'react';
import { Plug } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { llmUnavailableReason } from '@/hooks/useLlmStatus';
import type { LlmEffectiveConfig, LlmStatus } from '../../../types/llm';
import { useAdminApi } from '../hooks/use-admin-api';
import { describeThinkingCaps } from './fields';

interface Props {
  status: LlmStatus | undefined;
  effective: LlmEffectiveConfig;
  onProbed: () => void;
}

/** 运行状态面板：管理员看「现在到底能不能用、慢在哪、失败在哪」。 */
export const LlmStatusCard: React.FC<Props> = ({ status, effective, onProbed }) => {
  const api = useAdminApi();
  const [probing, setProbing] = useState(false);
  const blockedReason = llmUnavailableReason(status);
  const caps = status?.lastProbe?.capabilities ?? null;
  // 闸门容量超过服务端实际槽位时，多出来的请求只是换地方排队：界面得说明白，
  // 否则管理员会把「改了 max_concurrency 却没变快」当成网关有问题
  const overSlots =
    caps?.totalSlots != null && effective.maxConcurrency > caps.totalSlots
      ? `并发容量 ${effective.maxConcurrency} 超过服务端 ${caps.totalSlots} 个槽位（total_slots），多出来的请求只会在服务端排队`
      : null;
  const handleProbe = useCallback(() => {
    setProbing(true);
    api
      .probeLlm()
      .then((result) => {
        if (result.ok) {
          toast.success(
            result.modelListed === false
              ? `连接成功，但服务端模型列表里没有 ${result.expectedModel}`
              : `连接成功，共 ${result.models.length} 个模型`,
          );
        } else {
          toast.error(result.error ?? '连接失败');
        }
        onProbed();
      })
      .catch(() => toast.error('探活请求失败'))
      .finally(() => setProbing(false));
  }, [api, onProbed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>运行状态</CardTitle>
        <CardDescription>
          {blockedReason ?? '模型服务可用，工具页的「开始分析」按钮处于可点状态'}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Badge variant={blockedReason ? 'destructive' : 'secondary'}>
            {blockedReason ? '不可用' : '可用'}
          </Badge>
          <Button size="sm" variant="outline" onClick={handleProbe} disabled={probing}>
            {probing ? <Spinner data-icon="inline-start" /> : <Plug data-icon="inline-start" />}
            测试连接
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <Stat label="协议" value={effective.provider} />
          <Stat label="模型" value={effective.model || '(未设置)'} mono />
          <Stat label="服务地址" value={effective.baseUrl || '(未设置)'} mono />
          <Stat
            label="配置来源"
            value={effective.source === 'db' ? '数据库覆盖' : 'env 默认'}
          />
          <Stat
            label="服务端上报 n_ctx"
            value={caps?.nCtx != null ? String(caps.nCtx) : '未上报'}
          />
          <Stat
            label="服务端口数 / 构建"
            value={
              caps
                ? `${caps.totalSlots ?? '?'} / ${caps.buildInfo ?? '?'}`
                : '未上报'
            }
          />
          <Stat label="思考能力" value={describeThinkingCaps(caps)} />
          <Stat
            label="探活"
            value={
              status?.lastProbe
                ? status.lastProbe.ok
                  ? `正常（${status.lastProbe.models.length} 个模型）`
                  : (status.lastProbe.error ?? '失败')
                : '尚未探活'
            }
          />
          <Stat
            label="在途 / 排队"
            value={`${status?.gate.inflight ?? 0} / ${status?.gate.queued ?? 0}`}
          />
          <Stat
            label="并发容量 / 排队上限"
            value={`${effective.maxConcurrency} / ${effective.maxQueued}`}
          />
          <Stat label="P95 延迟" value={`${(status?.metrics.p95LatencyMs ?? 0) / 1000} s`} />
          <Stat
            label="请求数（成功/缓存/失败）"
            value={`${status?.metrics.requests ?? 0}（${status?.metrics.ok ?? 0}/${
              status?.metrics.cached ?? 0
            }/${status?.metrics.errors ?? 0}）`}
          />
          <Stat label="拒绝数（闸门满）" value={String(status?.metrics.rejections ?? 0)} />
          <Stat label="缓存命中率" value={`${status?.cache.hitPercent ?? 0}%`} />
          <Stat
            label="密钥"
            value={effective.apiKeySet ? effective.apiKeyMask : '未设置'}
            mono
          />
        </dl>
        {overSlots ? (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">{overSlots}</p>
        ) : null}
        {status && Object.keys(status.metrics.errorCodes).length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            错误分布：
            {Object.entries(status.metrics.errorCodes)
              .map(([code, count]) => `${code}×${count}`)
              .join('，')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`truncate text-sm text-foreground ${mono ? 'font-mono text-xs' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
