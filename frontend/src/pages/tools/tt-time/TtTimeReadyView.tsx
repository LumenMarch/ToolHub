import React from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Activity, BoxSelect, Database, GitCompare, RefreshCw, Sparkles } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Markdown } from '@/components/ui/markdown';
import {
  TtHistogramChart,
  TtPercentCurveChart,
  type HistogramMode,
} from './charts';
import {
  formatStationNumericName,
  type AnalysisContext,
  type Bin,
  type StationBoxGroup,
  type Stats,
} from './lib';
import type { ActiveModule, AnalysisResult, BackendProcessResponse } from './types';
import { StatItem } from './StatItem';
import { TtTimeExtraModules } from './TtTimeExtraModules';

export type TtTimeReadyViewProps = {
  fileName: string;
  processData: BackendProcessResponse | null;
  activeModule: ActiveModule;
  setActiveModule: (m: ActiveModule) => void;
  reset: () => void;
  excludeFail: boolean;
  setExcludeFail: (v: boolean) => void;
  mode: HistogramMode;
  setMode: (m: HistogramMode) => void;
  binWidthStr: string;
  setBinWidthStr: (v: string) => void;
  station: string;
  setStation: (v: string) => void;
  stations: string[];
  allStationBoxGroups: StationBoxGroup[];
  stats: Stats;
  bins: Bin[];
  analysisContext: AnalysisContext | null;
  adviceMutation: UseMutationResult<AnalysisResult, Error, AnalysisContext, unknown>;
};

export const TtTimeReadyView: React.FC<TtTimeReadyViewProps> = ({
  fileName,
  processData,
  activeModule,
  setActiveModule,
  reset,
  excludeFail,
  setExcludeFail,
  mode,
  setMode,
  binWidthStr,
  setBinWidthStr,
  station,
  setStation,
  stations,
  allStationBoxGroups,
  stats,
  bins,
  analysisContext,
  adviceMutation,
}) => {
  const adviceError =
    adviceMutation.isError && adviceMutation.error instanceof Error
      ? adviceMutation.error.message
      : adviceMutation.data?.error ?? null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4 shadow-xs">
        <div className="flex min-w-0 items-center gap-2">
          <Database className="size-4 shrink-0 text-primary" />
          <span className="truncate font-medium text-foreground">{fileName}</span>
          <span className="text-xs text-muted-foreground">
            ({allStationBoxGroups.length} 台机台 · {processData?.totalRows ?? 0} 条记录 · 计算耗时{' '}
            {processData?.elapsedMs ?? 0} ms)
          </span>
        </div>
        <div className="inline-flex rounded-lg border bg-muted/50 p-1 text-muted-foreground">
          <button
            type="button"
            onClick={() => setActiveModule('distribution')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
              activeModule === 'distribution'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'hover:text-foreground'
            }`}
          >
            <Activity className="size-3.5" />
            1. 测试时间分布
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('boxplot')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
              activeModule === 'boxplot'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'hover:text-foreground'
            }`}
          >
            <BoxSelect className="size-3.5" />
            2. 机台测试时间箱线图
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('comparison')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
              activeModule === 'comparison'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'hover:text-foreground'
            }`}
          >
            <GitCompare className="size-3.5" />
            3. 机台数据对比
          </button>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={reset}>
          <RefreshCw data-icon="inline-start" />
          重新上传
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-3">
          <Checkbox
            id="tt-exclude-fail"
            checked={excludeFail}
            onCheckedChange={(checked) => setExcludeFail(Boolean(checked))}
          />
          <label
            htmlFor="tt-exclude-fail"
            className="cursor-pointer text-sm font-medium leading-none select-none"
          >
            去除不良品数据 (Test Pass/Fail Status != PASS)
          </label>
        </div>
        <div className="text-xs text-muted-foreground">
          当前已过滤样本量：
          <span className="font-semibold text-foreground">{processData?.filteredRows ?? 0}</span> 条
        </div>
      </div>

      {activeModule === 'distribution' ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>统计口径</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-5 md:flex-row md:items-end md:gap-6">
                <Field className="flex-1">
                  <FieldLabel>统计模式</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === 'percent' ? 'default' : 'outline'}
                      onClick={() => setMode('percent')}
                    >
                      占比 %
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === 'count' ? 'default' : 'outline'}
                      onClick={() => setMode('count')}
                    >
                      样本数 Count
                    </Button>
                  </div>
                </Field>
                <Field className="w-full md:w-44">
                  <FieldLabel htmlFor="tt-bin-width">分箱宽度（秒）</FieldLabel>
                  <Input
                    id="tt-bin-width"
                    type="number"
                    min="1"
                    step="1"
                    value={binWidthStr}
                    onChange={(e) => setBinWidthStr(e.target.value)}
                  />
                </Field>
                <Field className="flex-1">
                  <FieldLabel htmlFor="tt-station">Station ID</FieldLabel>
                  <Select value={station} onValueChange={setStation}>
                    <SelectTrigger id="tt-station">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部机台（不区分）</SelectItem>
                      {stations.map((s) => (
                        <SelectItem key={s} value={s}>
                          {formatStationNumericName(s) === s
                            ? s
                            : `${formatStationNumericName(s)} (${s})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </CardContent>
          </Card>
          <div className="grid items-start gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>测试时间总结</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="divide-y divide-border/60">
                    <StatItem label="样本数" value={stats.count} unit="" />
                    <StatItem label="最大 Max" value={stats.max} />
                    <StatItem label="最小 Min" value={stats.min} />
                    <StatItem label="Q1" value={stats.q1} />
                    <StatItem label="Q2 中位数" value={stats.q2} />
                    <StatItem label="Q3" value={stats.q3} />
                  </dl>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>AI 分析建议</CardTitle>
                  <CardDescription>本地大模型 · 需已启动 llama.cpp 服务。</CardDescription>
                  {analysisContext ? (
                    <CardAction>
                      <Button
                        type="button"
                        size="sm"
                        disabled={adviceMutation.isPending}
                        onClick={() => adviceMutation.mutate(analysisContext)}
                      >
                        <Sparkles data-icon="inline-start" />
                        {adviceMutation.isPending ? '分析中…' : '开始分析'}
                      </Button>
                    </CardAction>
                  ) : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {adviceError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{adviceError}</AlertDescription>
                    </Alert>
                  ) : adviceMutation.data ? (
                    <div className="flex flex-col gap-2">
                      <Markdown className="leading-relaxed">{adviceMutation.data.advice}</Markdown>
                      <p className="text-xs text-muted-foreground">
                        {adviceMutation.data.model} · 耗时 {adviceMutation.data.elapsedMs} ms
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      基于当前筛选的统计结果调用本地大模型分析。
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>测试时间分布</CardTitle>
                </CardHeader>
                <CardContent>
                  <TtHistogramChart bins={bins} mode={mode} height={460} className="w-full" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>测试时间占比曲线</CardTitle>
                </CardHeader>
                <CardContent>
                  <TtPercentCurveChart bins={bins} height={320} className="w-full" />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      <TtTimeExtraModules
        activeModule={activeModule}
        fileName={fileName}
        allStationBoxGroups={allStationBoxGroups}
      />
    </div>
  );
};
