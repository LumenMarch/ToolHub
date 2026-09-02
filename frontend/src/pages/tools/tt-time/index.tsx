import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Database, RefreshCw, Sparkles } from 'lucide-react';

import api from '@/api/axios';
import FileDropZone from '@/components/FileDropZone';
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
import { TtCdfChart, TtHistogramChart, type HistogramMode } from './charts';
import {
  binByWidth,
  buildAnalysisContext,
  cdfPoints,
  computeStats,
  parseTestRows,
  type AnalysisContext,
  type ParseResult,
} from './lib';

type Phase = 'upload' | 'ready';

interface AnalysisResult {
  advice: string;
  model: string;
  elapsedMs: number;
  error?: string | null;
}

const DEFAULT_BIN_WIDTH = 10;

const StatItem: React.FC<{ label: string; value: number; unit?: string }> = ({
  label,
  value,
  unit = 'S',
}) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="text-sm font-semibold tabular-nums">
      {Number.isFinite(value)
        ? `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`
        : '—'}
    </dd>
  </div>
);

const TtTimeTool: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('upload');
  const [fileName, setFileName] = useState('');
  const [parse, setParse] = useState<ParseResult | null>(null);
  const [mode, setMode] = useState<HistogramMode>('percent');
  const [binWidthStr, setBinWidthStr] = useState(String(DEFAULT_BIN_WIDTH));
  const [station, setStation] = useState('all');

  // 去重机台列表
  const stations = useMemo(() => {
    if (!parse) return [] as string[];
    return [...new Set(parse.rows.map((r) => r.stationId))].sort();
  }, [parse]);

  // 按机台筛选后的测试时间
  const tts = useMemo(() => {
    if (!parse) return [] as number[];
    const rows =
      station === 'all' ? parse.rows : parse.rows.filter((r) => r.stationId === station);
    return rows.map((r) => r.tt);
  }, [parse, station]);

  // 分箱宽度：解析用户输入，非法/非正数回退到默认值
  const binWidth = useMemo(() => {
    const n = Number(binWidthStr.trim());
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_BIN_WIDTH;
  }, [binWidthStr]);

  const stats = useMemo(() => computeStats(tts), [tts]);
  const bins = useMemo(() => binByWidth(tts, binWidth), [tts, binWidth]);
  const cdf = useMemo(() => cdfPoints(tts), [tts]);

  const reset = () => {
    setPhase('upload');
    setParse(null);
    setFileName('');
    setStation('all');
  };

  const onFileSelect = async (file: File) => {
    const text = await file.text();
    const result = parseTestRows(text);
    setFileName(file.name);
    setParse(result);
    setStation('all');
    setPhase('ready');
  };

  // 机台 -> 该机台所有测试时间（用于 LLM 机台对比）
  const stationTtMap = useMemo(() => {
    if (!parse) return {} as Record<string, number[]>;
    const map: Record<string, number[]> = {};
    for (const row of parse.rows) {
      (map[row.stationId] ||= []).push(row.tt);
    }
    return map;
  }, [parse]);

  // 发送给后端的分析上下文（仅统计，不含原始数据）
  const analysisContext: AnalysisContext | null = useMemo(() => {
    if (tts.length === 0) return null;
    return buildAnalysisContext({
      fileName,
      stationFilter: station,
      tts,
      stats,
      bins,
      stations,
      stationTtMap,
    });
  }, [fileName, station, tts, stats, bins, stations, stationTtMap]);

  // 调用后端 -> 本地大模型生成分析结论
  const adviceMutation = useMutation({
    mutationFn: (ctx: AnalysisContext) =>
      api.post<AnalysisResult>('/tools/tt-time/analyze', ctx).then((r) => r.data),
  });

  if (phase === 'upload') {
    return (
      <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>上传测试日志 CSV</CardTitle>
            <CardDescription>数据仅在本地浏览器内解析，不上传服务器。</CardDescription>
          </CardHeader>
          <CardContent>
            <FileDropZone
              id="tt-time-csv"
              label="测试日志 CSV"
              description="拖拽或点击选择 Export-*.csv 文件"
              accept=".csv,text/csv"
              file={null}
              onSelect={(file) => void onFileSelect(file)}
            />
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Database className="size-4 shrink-0" />
              需要列：Station ID、StartTime、EndTime
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const parseError = parse && parse.rows.length === 0;
  const adviceError =
    adviceMutation.isError && adviceMutation.error instanceof Error
      ? adviceMutation.error.message
      : adviceMutation.data?.error ?? null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* 头部：文件名 + 重新上传 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Database className="size-4 shrink-0" />
          <span className="truncate">{fileName}</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={reset}>
          <RefreshCw data-icon="inline-start" />
          重新上传
        </Button>
      </div>

      {/* 解析失败提示 */}
      {parseError ? (
        <Alert variant="destructive">
          <AlertDescription>
            未解析到有效数据：请确认文件包含 Station ID / StartTime / EndTime 三列，
            且时间格式为 YYYY/M/D H:mm。
          </AlertDescription>
        </Alert>
      ) : null}

      {/* 统计口径控制 */}
      <Card>
        <CardHeader>
          <CardTitle>统计口径</CardTitle>
          <CardDescription>选择分布口径、分箱宽度与目标机台。</CardDescription>
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
                  aria-pressed={mode === 'percent'}
                >
                  占比 %
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'count' ? 'default' : 'outline'}
                  onClick={() => setMode('count')}
                  aria-pressed={mode === 'count'}
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
                <SelectTrigger id="tt-station" aria-label="Station ID">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部机台（不区分）</SelectItem>
                  {stations.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* 主体：左总结 + 右图表 */}
      <div className="grid items-start gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
        {/* 左侧：统计总结 + AI */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>测试时间总结</CardTitle>
              <CardDescription>
                单位：秒。分位数为线性插值（PERCENTILE.INC），保留一位小数。
              </CardDescription>
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
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {adviceMutation.data.advice}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {adviceMutation.data.model} · 耗时 {adviceMutation.data.elapsedMs} ms
                  </p>
                </div>
              ) : analysisContext ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  基于当前筛选的统计结果，调用本地大模型定位异常测试时间值（长尾样本），并给出机台/程序层面的排查、解决与验证方法。
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  当前筛选无样本数据，无法生成分析建议。
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧：图表 */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>测试时间分布</CardTitle>
              <CardDescription>
                {mode === 'percent' ? '占比 %' : '样本数 Count'} · 按时间分箱
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TtHistogramChart bins={bins} mode={mode} height={460} className="w-full" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>累计分布曲线</CardTitle>
              <CardDescription>CDF · 测试时间(S) vs 累计占比(%)</CardDescription>
            </CardHeader>
            <CardContent>
              <TtCdfChart points={cdf} className="w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default TtTimeTool;
