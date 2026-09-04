import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Activity,
  BoxSelect,
  Database,
  Download,
  GitCompare,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';

import api from '@/api/axios';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useTusUpload } from '@/hooks/useTusUpload';
import { LoadingSignal } from '@/components/LoadingSignal';
import { Markdown } from '@/components/ui/markdown';
import {
  TtHistogramChart,
  TtPercentCurveChart,
  TtStationBoxPlotChart,
  TtStationQ3LineChart,
  type HistogramMode,
  type StationBoxPlotHandle,
  type StationQ3LineChartHandle,
} from './charts';
import {
  buildAnalysisContext,
  formatStationNumericName,
  type AnalysisContext,
  type Bin,
  type ComparisonReferenceLine,
  type StationBoxGroup,
  type Stats,
} from './lib';
import { StationComparisonTable } from './StationComparisonTable';

type Phase = 'upload' | 'analyzing' | 'ready';
type ActiveModule = 'distribution' | 'boxplot' | 'comparison';

interface BackendProcessResponse {
  filename: string;
  totalRows: number;
  filteredRows: number;
  stations: string[];
  stats: Stats;
  bins: Bin[];
  cdf: { x: number; y: number }[];
  stationBoxGroups: StationBoxGroup[];
  comparisonTable: {
    stations: string[];
    stationNumerics: string[];
    rows: { label: '最大值' | 'Q3' | 'Med' | 'Q1' | '最小值'; values: Record<string, number> }[];
  };
  elapsedMs: number;
}

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
  const [activeModule, setActiveModule] = useState<ActiveModule>('distribution');

  const [currentUploadId, setCurrentUploadId] = useState<string>('');
  const [fileName, setFileName] = useState('');
  const [processData, setProcessData] = useState<BackendProcessResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // 模块 1：分布相关状态
  const [mode, setMode] = useState<HistogramMode>('percent');
  const [binWidthStr, setBinWidthStr] = useState(String(DEFAULT_BIN_WIDTH));
  const [station, setStation] = useState('all');
  const [excludeFail, setExcludeFail] = useState(true);

  // 模块 2：箱线图相关状态
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | 'all'>('all');
  const [lockdownTTStr, setLockdownTTStr] = useState('');
  const [exportingGroup, setExportingGroup] = useState<number | null>(null);

  // 模块 3：机台数据对比相关状态
  const [customComparisonTitle, setCustomComparisonTitle] = useState('');
  const [referenceLines, setReferenceLines] = useState<ComparisonReferenceLine[]>([]);
  const [newLineValue, setNewLineValue] = useState('');
  const [newLineLabel, setNewLineLabel] = useState('');
  const [isExportingComparisonChart, setIsExportingComparisonChart] = useState(false);

  const boxPlotRefs = useRef<Record<number, StationBoxPlotHandle | null>>({});
  const q3LineChartRef = useRef<StationQ3LineChartHandle | null>(null);
  const processGenRef = useRef(0);

  const binWidth = useMemo(() => {
    const n = Number(binWidthStr.trim());
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_BIN_WIDTH;
  }, [binWidthStr]);

  // 后端高速计算触发器
  const runBackendProcess = useCallback(
    async (
      uploadId: string,
      options: {
        binWidthVal: number;
        stationVal: string;
        excludeFailVal: boolean;
      },
    ) => {
      if (!uploadId) return;
      const gen = ++processGenRef.current;
      setErrorMessage('');

      try {
        const res = await api.post<BackendProcessResponse>('/tools/tt-time/process', {
          upload_id: uploadId,
          bin_width: options.binWidthVal,
          station_filter: options.stationVal,
          exclude_fail: options.excludeFailVal,
        });

        if (gen !== processGenRef.current) return;
        setProcessData(res.data);
        setPhase('ready');
      } catch (err: unknown) {
        if (gen !== processGenRef.current) return;
        const msg =
          err instanceof Error
            ? err.message
            : (err as { response?: { data?: { detail?: string } } })?.response?.data
                ?.detail || '后端数据处理失败';
        setErrorMessage(String(msg));
        setPhase('ready');
      }
    },
    [],
  );

  const tusUpload = useTusUpload({
    onSuccess: (uploadId) => {
      setCurrentUploadId(uploadId);
      setPhase('analyzing');
      void runBackendProcess(uploadId, {
        binWidthVal: binWidth,
        stationVal: station,
        excludeFailVal: excludeFail,
      });
    },
    onError: (err) => {
      setErrorMessage(err.message || '文件上传失败');
      setPhase('upload');
    },
  });

  const onFileSelect = (file: File) => {
    setFileName(file.name);
    setCustomComparisonTitle(`${file.name.replace(/\.[^/.]+$/, '')} 各机台数据对比`);
    setErrorMessage('');
    setProcessData(null);
    setStation('all');
    setExcludeFail(true);
    setSelectedGroupIdx('all');
    setLockdownTTStr('');
    setPhase('upload');
    void tusUpload.upload({ file, metadata: { filename: file.name } });
  };

  // 当筛选条件变更且在 ready 阶段时，重新向后端请求统计数据
  useEffect(() => {
    if (!currentUploadId || phase !== 'ready') return;
    void runBackendProcess(currentUploadId, {
      binWidthVal: binWidth,
      stationVal: station,
      excludeFailVal: excludeFail,
    });
  }, [currentUploadId, binWidth, station, excludeFail, runBackendProcess, phase]);

  const reset = () => {
    tusUpload.reset();
    setPhase('upload');
    setCurrentUploadId('');
    setProcessData(null);
    setFileName('');
    setStation('all');
    setExcludeFail(true);
    setSelectedGroupIdx('all');
    setLockdownTTStr('');
    setActiveModule('distribution');
    setCustomComparisonTitle('');
    setErrorMessage('');
  };

  // 机台列表（按纯数字升序排序）
  const stations = useMemo(() => {
    return processData?.stations ?? [];
  }, [processData]);

  // 机台箱线图数据
  const allStationBoxGroups = useMemo(() => {
    return processData?.stationBoxGroups ?? [];
  }, [processData]);

  // 将机台分成每组最多 10 个数据
  const stationBoxChunks = useMemo(() => {
    const chunks: StationBoxGroup[][] = [];
    for (let i = 0; i < allStationBoxGroups.length; i += 10) {
      chunks.push(allStationBoxGroups.slice(i, i + 10));
    }
    return chunks;
  }, [allStationBoxGroups]);

  // 解析手动输入的 lockdown TT
  const lockdownTT = useMemo(() => {
    const val = Number(lockdownTTStr.trim());
    return Number.isFinite(val) && val > 0 ? val : null;
  }, [lockdownTTStr]);

  const stats: Stats = useMemo(() => {
    return (
      processData?.stats ?? {
        count: 0,
        min: NaN,
        max: NaN,
        q1: NaN,
        q2: NaN,
        q3: NaN,
      }
    );
  }, [processData]);

  const bins: Bin[] = useMemo(() => {
    return processData?.bins ?? [];
  }, [processData]);


  // 发送给后端的分析上下文（用于大模型建议）
  const analysisContext: AnalysisContext | null = useMemo(() => {
    if (!processData || processData.filteredRows === 0) return null;
    return buildAnalysisContext({
      fileName,
      stationFilter: station,
      tts: [stats.min, stats.q1, stats.q2, stats.q3, stats.max].filter(Number.isFinite),
      stats,
      bins,
      stations,
    });
  }, [processData, fileName, station, stats, bins, stations]);

  // 调用后端 -> 本地大模型生成分析结论
  const adviceMutation = useMutation({
    mutationFn: (ctx: AnalysisContext) =>
      api.post<AnalysisResult>('/tools/tt-time/analyze', ctx).then((r) => r.data),
  });

  // 添加参考线
  const handleAddReferenceLine = () => {
    const val = Number(newLineValue.trim());
    if (!Number.isFinite(val) || val <= 0) return;
    const line: ComparisonReferenceLine = {
      id: `ref-${Date.now()}`,
      value: val,
      label: newLineLabel.trim() || `${val}S 阈值`,
      color: '#ef4444',
    };
    setReferenceLines((prev) => [...prev, line]);
    setNewLineValue('');
    setNewLineLabel('');
  };

  // 移除参考线
  const handleRemoveReferenceLine = (id: string) => {
    setReferenceLines((prev) => prev.filter((l) => l.id !== id));
  };

  // 导出机台数据对比折线图为 PNG
  const handleExportComparisonChartPng = async () => {
    if (!q3LineChartRef.current) return;
    try {
      setIsExportingComparisonChart(true);
      const title =
        customComparisonTitle.trim() ||
        `${fileName.replace(/\.[^/.]+$/, '') || '测试日志'}_各机台数据对比`;
      await q3LineChartRef.current.exportPng(title);
    } finally {
      setIsExportingComparisonChart(false);
    }
  };

  if (phase === 'upload' || phase === 'analyzing') {
    const isUploading = tusUpload.status === 'uploading';
    const progress = Math.round(tusUpload.progress);

    return (
      <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>上传测试日志</CardTitle>
            <CardDescription>
              支持超大数据文件秒级解析，采用 Polars 高性能多线程计算引擎。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FileDropZone
              id="tt-time-file"
              label="测试日志文件"
              description="拖拽或点击选择 Export-*.csv、.xlsx 或 .xls 文件"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              file={null}
              disabled={isUploading || phase === 'analyzing'}
              onSelect={onFileSelect}
            />

            {isUploading ? (
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>正在极速上传文件...</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : null}

            {phase === 'analyzing' ? (
              <div className="flex items-center justify-center gap-3 py-6 text-sm text-muted-foreground">
                <LoadingSignal label="分析中" ariaLabel="后端 Polars 引擎正在分析数据" />
                <span>后端 Polars 引擎正在多线程分析数据...</span>
              </div>
            ) : null}

            {errorMessage ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}

            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Database className="size-4 shrink-0" />
              支持列：Station ID、StartTime、EndTime、Test Pass/Fail Status（可选）
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const parseError = !processData || processData.totalRows === 0 || errorMessage;
  const adviceError =
    adviceMutation.isError && adviceMutation.error instanceof Error
      ? adviceMutation.error.message
      : adviceMutation.data?.error ?? null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* 头部工具栏：文件名 + 模块 Tab 切换 + 重新上传 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4 shadow-xs">
        <div className="flex min-w-0 items-center gap-2">
          <Database className="size-4 shrink-0 text-primary" />
          <span className="truncate font-medium text-foreground">{fileName}</span>
          <span className="text-xs text-muted-foreground">
            ({allStationBoxGroups.length} 台机台 · {processData?.totalRows ?? 0} 条记录 · 计算耗时{' '}
            {processData?.elapsedMs ?? 0} ms)
          </span>
        </div>

        {/* 3 个图模块 Tab 导航 */}
        <div className="inline-flex rounded-lg border bg-muted/50 p-1 text-muted-foreground">
          <button
            type="button"
            onClick={() => setActiveModule('distribution')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
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
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
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
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
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

      {/* 解析失败提示 */}
      {parseError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage ||
              '未解析到有效数据：请确认文件包含 Station ID / StartTime / EndTime 三列，且时间格式为 YYYY/M/D H:mm。'}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* 全局不良过滤与快速控制栏 */}
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
          <span className="font-semibold text-foreground">
            {processData?.filteredRows ?? 0}
          </span>{' '}
          条
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 模块 1：测试时间分布                                                    */}
      {/* ========================================================================= */}
      {activeModule === 'distribution' ? (
        <div className="flex flex-col gap-6">
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
                      <Markdown className="leading-relaxed">
                        {adviceMutation.data.advice}
                      </Markdown>
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
                  <CardTitle>测试时间占比曲线</CardTitle>
                  <CardDescription>按时间分箱区间的占比 (%) 分布平滑曲线</CardDescription>
                </CardHeader>
                <CardContent>
                  <TtPercentCurveChart bins={bins} height={320} className="w-full" />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* 模块 2：机台测试时间箱线图                                              */}
      {/* ========================================================================= */}
      {activeModule === 'boxplot' ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">显示分组：</span>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedGroupIdx === 'all' ? 'default' : 'outline'}
                  onClick={() => setSelectedGroupIdx('all')}
                >
                  全部分组 ({stationBoxChunks.length})
                </Button>
                {stationBoxChunks.map((chunk, groupIndex) => {
                  const groupKey = `group-${chunk[0]?.stationId ?? ''}-${chunk.length}`;
                  return (
                    <Button
                      key={groupKey}
                      type="button"
                      size="sm"
                      variant={selectedGroupIdx === groupIndex ? 'default' : 'outline'}
                      onClick={() => setSelectedGroupIdx(groupIndex)}
                    >
                      第 {groupIndex + 1} 组
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="box-lockdown-tt"
                className="text-sm font-medium text-muted-foreground whitespace-nowrap"
              >
                Lockdown TT:
              </label>
              <Input
                id="box-lockdown-tt"
                type="number"
                step="any"
                placeholder="输入红线标注值 (S)"
                className="h-8 w-44"
                value={lockdownTTStr}
                onChange={(e) => setLockdownTTStr(e.target.value)}
              />
            </div>
          </div>

          {stationBoxChunks.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                未检索到机台数据
              </CardContent>
            </Card>
          ) : (
            stationBoxChunks.map((chunk, index) => {
              if (selectedGroupIdx !== 'all' && selectedGroupIdx !== index) {
                return null;
              }
                const fromNum = index * 10 + 1;
                const toNum = index * 10 + chunk.length;
                const isExporting = exportingGroup === index;

                const handleExport = async () => {
                  const handle = boxPlotRefs.current[index];
                  if (!handle) return;
                  try {
                    setExportingGroup(index);
                    const cleanName = (fileName || 'tt-time').replace(/\.[^/.]+$/, '');
                    await handle.exportPng(`${cleanName}_箱线图_第${index + 1}组`);
                  } finally {
                    setExportingGroup(null);
                  }
                };

                return (
                  <Card key={`station-box-chunk-${fromNum}-${toNum}`}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <CardTitle>
                            机台测试时间箱线图（第 {index + 1} 组：Station {fromNum} ~ {toNum}）
                          </CardTitle>
                          <CardDescription>
                            X 轴为 Station ID，Y 轴为测试时间(S)。绿色实线为平均值，红色实线为 Lockdown TT。
                          </CardDescription>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isExporting}
                          onClick={() => void handleExport()}
                        >
                          <Download data-icon="inline-start" />
                          {isExporting ? '导出中…' : '导出图片'}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <TtStationBoxPlotChart
                        ref={(el) => {
                          boxPlotRefs.current[index] = el;
                        }}
                        groups={chunk}
                        lockdownTT={lockdownTT}
                        className="w-full"
                      />
                    </CardContent>
                  </Card>
                );
              })
          )}
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* 模块 3：机台数据对比（表格 + Q3 折线图）                                 */}
      {/* ========================================================================= */}
      {activeModule === 'comparison' ? (
        <div className="flex flex-col gap-6">
          {/* 参考线配置与标题控制 */}
          <Card>
            <CardHeader>
              <CardTitle>图表设置与参考线标注</CardTitle>
              <CardDescription>
                自定义图表标题，在 Q3 折线图上添加水平参考线与文本说明。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <Field className="flex-1">
                  <FieldLabel htmlFor="comp-title">图表主标题</FieldLabel>
                  <Input
                    id="comp-title"
                    value={customComparisonTitle}
                    placeholder="输入图表主标题"
                    onChange={(e) => setCustomComparisonTitle(e.target.value)}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isExportingComparisonChart || allStationBoxGroups.length === 0}
                    onClick={() => void handleExportComparisonChartPng()}
                    className="gap-2"
                  >
                    <Download className="size-4" />
                    {isExportingComparisonChart ? '正在导出...' : '导出折线图 PNG'}
                  </Button>
                </div>
              </div>

              {/* 参考线管理列表 */}
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
                <div className="text-xs font-semibold text-foreground">
                  参考线标注（折线图水平标记线）
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    step="any"
                    placeholder="耗时(S)，如 190"
                    className="w-32"
                    value={newLineValue}
                    onChange={(e) => setNewLineValue(e.target.value)}
                  />
                  <Input
                    placeholder="文本说明（可选，如 基准线 / 目标值）"
                    className="w-64 flex-1"
                    value={newLineLabel}
                    onChange={(e) => setNewLineLabel(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleAddReferenceLine}
                    className="gap-1"
                  >
                    <Plus className="size-3.5" />
                    添加参考线
                  </Button>
                </div>

                {referenceLines.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {referenceLines.map((line) => (
                      <div
                        key={line.id}
                        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs shadow-2xs"
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: line.color || '#ef4444' }}
                        />
                        <span className="font-bold text-foreground tabular-nums">
                          {line.value}S
                        </span>
                        <span className="text-muted-foreground">{line.label}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveReferenceLine(line.id)}
                          className="ml-1 text-muted-foreground transition-colors hover:text-destructive"
                          title="删除参考线"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* 1. 五数汇总表格 */}
          <Card>
            <CardHeader>
              <CardTitle>各机台五数统计数据</CardTitle>
              <CardDescription>
                包含各机台的最大值、Q3 (上四分位)、Med (中位数)、Q1 (下四分位) 与最小值。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StationComparisonTable
                groups={allStationBoxGroups}
                title={customComparisonTitle.trim() || `${fileName} 各机台数据对比`}
              />
            </CardContent>
          </Card>

          {/* 2. 各机台 Q3 对比折线图 */}
          <Card>
            <CardHeader>
              <CardTitle>各机台 Q3 耗时对比折线图</CardTitle>
              <CardDescription>
                展示各机台的 Q3 (上四分位数) 测试时间，红线为设备分类参考线。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TtStationQ3LineChart
                ref={q3LineChartRef}
                groups={allStationBoxGroups}
                referenceLines={referenceLines}
                title={customComparisonTitle.trim() || undefined}
                className="w-full"
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
};

export default TtTimeTool;
