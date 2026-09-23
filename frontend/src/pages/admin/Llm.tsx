import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLlmStatus } from '@/hooks/useLlmStatus';
import type { LlmConfigResponse } from '@/types/llm';
import AdminLoadingState from './components/AdminLoadingState';
import { useAdminApi } from './hooks/use-admin-api';
import { LlmConfigCard } from './llm/LlmConfigCard';
import { LlmStatusCard } from './llm/LlmStatusCard';

/**
 * 模型服务管理页。
 *
 * 页面只做三件事：拉配置、管错误态、把「生效配置」和「覆盖层」交给两张卡。
 * 状态卡与配置卡各自持有自己的交互状态，页面不替它们管表单值 —— 配置字段
 * 有 16 个，集中放在页面里会让这个组件既难读又难测。
 */
const AdminLlm: React.FC = () => {
  const api = useAdminApi();
  const { data: status, refetch: refetchStatus } = useLlmStatus();
  const [config, setConfig] = useState<LlmConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .getLlmConfig()
      .then((data) => {
        setConfig(data);
        setError('');
      })
      .catch(() => setError('加载模型服务配置失败'))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <AdminLoadingState
        ariaLabel="加载模型服务配置"
        label="正在读取模型服务配置"
        detail="读取生效配置、覆盖层与运行指标"
      />
    );
  }

  if (error || !config) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无法打开模型服务配置</AlertTitle>
        <AlertDescription className="flex items-center gap-3">
          {error || '配置数据为空'}
          <Button size="sm" variant="outline" onClick={refresh}>
            <RefreshCw data-icon="inline-start" />
            重试
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <LlmStatusCard
        status={status}
        effective={config.effective}
        onProbed={() => void refetchStatus()}
      />
      <LlmConfigCard
        config={config}
        capabilities={status?.lastProbe?.capabilities ?? null}
        onSaved={(next) => {
          setConfig(next);
          void refetchStatus();
        }}
      />
    </div>
  );
};

export default AdminLlm;
