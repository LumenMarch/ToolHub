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
import type {
  LlmCapabilities,
  LlmEffectiveConfig,
  LlmStatus,
} from '../../../types/llm';
import { useAdminApi } from '../hooks/use-admin-api';
import { describeThinkingCaps } from './fields';

interface Props {
  status: LlmStatus | undefined;
  effective: LlmEffectiveConfig;
  onProbed: () => void;
}

/** 运行状态面板：管理员看「现在到底能不能用、慢在哪、失败在哪」。 */
export const LlmStatusCard: React.FC<Props> = ({ status, effective, onProbed }) => {
  const blockedReason = llmUnavailableReason(status);
  const caps = status?.lastProbe?.capabilities ?? null;
  const overSlots = overSlotsWarning(caps, effective.maxConcurrency);
  const errorCodes = errorCodesLabel(status);

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
          <TestConnectionButton onProbed={onProbed} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <StatsGrid status={status} effective={effective} caps={caps} />
        {overSlots ? (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">{overSlots}</p>
        ) : null}
        {errorCodes ? (
          <p className="mt-3 text-xs text-muted-foreground">错误分布：{errorCodes}</p>
        ) : null}
      </CardContent>
    </Card>
  );
};

/** 探活按钮：自己持有 probing 态，成功/失败都以 toast 反馈。 */
const TestConnectionButton: React.FC<{ onProbed: () => void }> = ({ onProbed }) => {
  const api = useAdminApi();
  const [probing, setProbing] = useState(false);

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
    <Button size="sm" variant="outline" onClick={handleProbe} disabled={probing}>
      {probing ? <Spinner data-icon="inline-start" /> : <Plug data-icon="inline-start" />}
      测试连接
    </Button>
  );
};

interface StatsGridProps {
  status: LlmStatus | undefined;
  effective: LlmEffectiveConfig;
  caps: LlmCapabilities | null;
}

const StatsGrid: React.FC<StatsGridProps> = ({ status, effective, caps }) => (
  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
    <Stat label="协议" value={effective.provider} />
    <Stat label="模型" value={effective.model || '(未设置)'} mono />
    <Stat label="服务地址" value={effective.baseUrl || '(未设置)'} mono />
    <Stat label="配置来源" value={configSourceLabel(effective.source)} />
    <Stat label="服务端上报 n_ctx" value={nCtxLabel(caps)} />
    <Stat label="服务端口数 / 构建" value={slotsStatLabel(caps)} />
    <Stat label="思考能力" value={describeThinkingCaps(caps)} />
    <Stat label="探活" value={probeStatLabel(status)} />
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
);

function configSourceLabel(source: LlmEffectiveConfig['source']): string {
  return source === 'db' ? '数据库覆盖' : 'env 默认';
}

function nCtxLabel(caps: LlmCapabilities | null): string {
  return caps?.nCtx != null ? String(caps.nCtx) : '未上报';
}

function slotsStatLabel(caps: LlmCapabilities | null): string {
  return caps ? `${caps.totalSlots ?? '?'} / ${caps.buildInfo ?? '?'}` : '未上报';
}

function probeStatLabel(status: LlmStatus | undefined): string {
  const probe = status?.lastProbe;
  if (!probe) return '尚未探活';
  return probe.ok ? `正常（${probe.models.length} 个模型）` : (probe.error ?? '失败');
}

// 闸门容量超过服务端实际槽位时，多出来的请求只是换地方排队：界面得说明白，
// 否则管理员会把「改了 max_concurrency 却没变快」当成网关有问题
function overSlotsWarning(
  caps: LlmCapabilities | null,
  maxConcurrency: number,
): string | null {
  if (caps?.totalSlots == null || maxConcurrency <= caps.totalSlots) return null;
  return `并发容量 ${maxConcurrency} 超过服务端 ${caps.totalSlots} 个槽位（total_slots），多出来的请求只会在服务端排队`;
}

function errorCodesLabel(status: LlmStatus | undefined): string | null {
  const codes = status?.metrics.errorCodes;
  if (!codes || Object.keys(codes).length === 0) return null;
  return Object.entries(codes)
    .map(([code, count]) => `${code}×${count}`)
    .join('，');
}

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
