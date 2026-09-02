import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowsClockwise,
  FileCsv,
  MagicWand,
  Warning,
} from '@phosphor-icons/react';

import api from '../../../api/axios';
import FileDropZone from '../../../components/FileDropZone';
import {
  TtCdfChart,
  TtHistogramChart,
  type HistogramMode,
} from './charts';
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
  <div className="flex items-baseline justify-between border-b border-border/60 pb-2 last:border-b-0">
    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted-foreground">
      {label}
    </span>
    <span className="font-mono text-lg font-semibold tabular-nums">
      {Number.isFinite(value)
        ? `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`
        : '—'}
    </span>
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

  return (
    <div className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto">
      {phase === 'upload' ? (
        <section className="flex flex-col items-center gap-8 py-10">
          <div className="text-center">
            <p className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary">
              Tool / Test Time
            </p>
            <h2 className="text-[26px] font-bold tracking-tight md:text-[30px]">
              TT 时间计算
            </h2>
            <p className="mx-auto mt-3 max-w-xl font-mono text-xs text-muted-foreground">
              上传测试工站导出的日志 CSV，按机台统计测试时间分布、占比与累计曲线。
              数据仅在本地浏览器内解析，不上传服务器。
            </p>
          </div>

          <FileDropZone
            id="tt-time-csv"
            label="测试日志 CSV"
            description="拖拽或点击选择 Export-*.csv 文件"
            accept=".csv,text/csv"
            file={null}
            onSelect={onFileSelect}
          />

          <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <FileCsv weight="fill" className="size-4" />
            需要列：Station ID、StartTime、EndTime
          </div>
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          {/* 头部：文件名 + 控制条 */}
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
            <div>
              <p className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary">
                Tool / Test Time
              </p>
              <h2 className="text-[22px] font-bold tracking-tight md:text-[26px]">
                TT 时间计算
              </h2>
              <p className="mt-1 max-w-xl truncate font-mono text-xs text-muted-foreground">
                {fileName}
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-primary"
            >
              <ArrowsClockwise weight="bold" className="size-4" />
              重新上传
            </button>
          </header>

          {/* 数据异常提示 */}
          {parse && parse.rows.length === 0 && (
            <div className="flex items-center gap-4 border border-status-danger-foreground/40 bg-status-danger-surface px-5 py-4">
              <Warning weight="fill" className="size-5 shrink-0 text-status-danger-foreground" />
              <p className="font-mono text-xs text-status-danger-foreground">
                未解析到有效数据：请确认文件包含 Station ID / StartTime / EndTime 三列，
                且时间格式为 YYYY/M/D H:mm。
              </p>
            </div>
          )}

          {/* 控件行 */}
          <div className="flex flex-wrap items-end gap-6">
            {/* 模式切换 */}
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted-foreground">
                统计模式
              </span>
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                {(['percent', 'count'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`px-4 py-1.5 font-mono text-xs uppercase tracking-widest transition-colors ${
                      mode === m
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m === 'percent' ? '百分比' : 'Count'}
                  </button>
                ))}
              </div>
            </div>

            {/* 桶宽 */}
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted-foreground">
                分箱宽度
              </span>
              <input
                type="number"
                min="1"
                step="1"
                value={binWidthStr}
                onChange={(e) => setBinWidthStr(e.target.value)}
                className="w-40 rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-sm"
                aria-label="分箱宽度（秒）"
              />
            </label>

            {/* 机台筛选 */}
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted-foreground">
                Station ID
              </span>
              <select
                value={station}
                onChange={(e) => setStation(e.target.value)}
                className="max-w-72 rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-sm"
              >
                <option value="all">全部机台（不区分）</option>
                {stations.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* 主体：左总结 + 右图表 */}
          <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
            {/* 左侧总结 */}
            <aside className="flex h-fit flex-col gap-5 rounded-lg border border-border bg-card p-5">
              <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary">
                测试时间总结
              </p>
              <div className="flex flex-col gap-3">
                <StatItem label="样本数" value={stats.count} unit="" />
                <StatItem label="最大 Max" value={stats.max} />
                <StatItem label="最小 Min" value={stats.min} />
                <StatItem label="Q1" value={stats.q1} />
                <StatItem label="Q2 中位数" value={stats.q2} />
                <StatItem label="Q3" value={stats.q3} />
              </div>
              <p className="border-t border-border/60 pt-3 font-mono text-[0.625rem] leading-relaxed text-muted-foreground">
                单位：秒。分位数为线性插值（PERCENTILE.INC），保留一位小数。
              </p>

              {/* AI 分析建议 */}
              <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary">
                    AI 分析建议
                    <span className="ml-1 text-muted-foreground">本地大模型</span>
                  </p>
                  <button
                    type="button"
                    disabled={!analysisContext || adviceMutation.isPending}
                    onClick={() => {
                      if (analysisContext) adviceMutation.mutate(analysisContext);
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-primary bg-primary px-3 py-1 font-mono text-[0.6875rem] uppercase tracking-widest text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <MagicWand weight="bold" className="size-3.5" />
                    {adviceMutation.isPending ? '分析中…' : '开始分析'}
                  </button>
                </div>

                {adviceMutation.isError && (
                  <p className="rounded-md border border-status-danger-foreground/40 bg-status-danger-surface px-3 py-2 font-mono text-xs text-status-danger-foreground">
                    {adviceMutation.error instanceof Error
                      ? adviceMutation.error.message
                      : '本地大模型不可用'}
                  </p>
                )}

                {adviceMutation.data && adviceMutation.data.error ? (
                  <p className="rounded-md border border-status-danger-foreground/40 bg-status-danger-surface px-3 py-2 font-mono text-xs text-status-danger-foreground">
                    {adviceMutation.data.error}
                  </p>
                ) : adviceMutation.data ? (
                  <div className="flex flex-col gap-2">
                    <pre className="whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-relaxed text-foreground">
                      {adviceMutation.data.advice}
                    </pre>
                    <p className="font-mono text-[0.625rem] text-muted-foreground">
                      {adviceMutation.data.model} · 耗时 {adviceMutation.data.elapsedMs} ms
                    </p>
                  </div>
                ) : (
                  <p className="font-mono text-xs leading-relaxed text-muted-foreground">
                    基于当前筛选的统计结果，调用本地大模型生成测试时间分析结论与改进建议。
                  </p>
                )}
              </div>
            </aside>

            {/* 右侧图表 */}
            <div className="flex min-w-0 flex-col gap-6">
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary">
                  测试时间分布
                  <span className="ml-2 text-muted-foreground">
                    {mode === 'percent' ? '占比 %' : '样本数 Count'}
                  </span>
                </p>
                <TtHistogramChart
                  bins={bins}
                  mode={mode}
                  height={460}
                />
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary">
                  累计分布曲线
                  <span className="ml-2 text-muted-foreground">CDF</span>
                </p>
                <TtCdfChart points={cdf} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TtTimeTool;
