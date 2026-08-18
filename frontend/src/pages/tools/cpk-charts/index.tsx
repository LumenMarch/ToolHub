import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChartBar,
  MagnifyingGlass,
  ArrowCounterClockwise,
  WarningCircle,
  Database,
} from '@phosphor-icons/react';
import { gsap } from 'gsap';

import FileDropZone from '../../../components/FileDropZone';
import { cn } from '../../../lib/cn';
import {
  SAMPLE_COLUMNS,
  SAMPLE_DATA_STR,
  SAMPLE_TITLE,
} from './data/sample';
import CpkHistogram from './components/CpkHistogram';
import { datasetFromSample, parseTestCsv, type ParsedDataset } from './lib/csv';
import { analyzeColumn, formatIndex, formatValue, shortName } from './lib/stats';

const buildSampleDataset = (): ParsedDataset =>
  datasetFromSample(SAMPLE_TITLE, SAMPLE_COLUMNS, SAMPLE_DATA_STR);

const CpkChartsTool: React.FC = () => {
  const [dataset, setDataset] = useState<ParsedDataset | null>(buildSampleDataset);
  const [fileName, setFileName] = useState('示例数据：HILO1 / B482（158 台）');
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 入场动效（与平台其它工具一致）
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.from('.gsap-reveal', {
        y: 16,
        opacity: 0,
        duration: 0.65,
        stagger: 0.08,
        ease: 'expo.out',
        delay: 0.12,
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const analysis = useMemo(() => {
    if (!dataset || dataset.columns.length === 0) return null;
    const idx = Math.min(selected, dataset.columns.length - 1);
    const column = dataset.columns[idx];
    const raw = dataset.rows.map((row) => row[idx] ?? 'NA');
    return { analysis: analyzeColumn(column, raw), index: idx };
  }, [dataset, selected]);

  const filtered = useMemo(() => {
    if (!dataset) return [];
    const q = query.trim().toLowerCase();
    return dataset.columns
      .map((c, i) => ({ column: c, index: i }))
      .filter(({ column }) => !q || column.name.toLowerCase().includes(q));
  }, [dataset, query]);

  const handleFile = async (f: File) => {
    setError('');
    setFile(f);
    try {
      const text = await f.text();
      const ds = parseTestCsv(text);
      if (ds.columns.length === 0) {
        setError('未在文件中找到含数值的测试项列');
        return;
      }
      setDataset(ds);
      setFileName(f.name);
      setSelected(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSV 解析失败');
    }
  };

  const loadSample = () => {
    setDataset(buildSampleDataset());
    setFileName('示例数据：HILO1 / B482（158 台）');
    setSelected(0);
    setQuery('');
    setError('');
    setFile(null);
  };

  const active = analysis?.analysis ?? null;
  const activeIndex = analysis?.index ?? 0;

  const cpkBadge = (() => {
    if (!active || active.stat.cpk === null) return null;
    const cpk = active.stat.cpk;
    if (cpk >= 1.33) return { text: 'CAPABLE / 制程能力良好', tone: 'border-status-success-foreground bg-status-success-surface text-status-success-foreground' };
    if (cpk >= 1.0) return { text: 'MARGINAL / 制程能力勉强', tone: 'border-status-warning-foreground bg-status-warning-surface text-status-warning-foreground' };
    return { text: 'LOW / 制程能力不足', tone: 'border-status-danger-foreground bg-status-danger-surface text-status-danger-foreground' };
  })();

  return (
    <div
      ref={containerRef}
      className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto"
    >
      <div className="relative z-10 grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
        {/* 左侧：数据源 + 测试项列表 */}
        <aside className="gsap-reveal flex flex-col gap-8 self-start lg:sticky lg:top-28 lg:col-span-4">
          <div className="flex flex-col gap-2 border-b border-border pb-4">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
              [ SOURCE / 数据源 ]
            </span>
            <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
              测试数据 CPK 可视化
            </h2>
            <p className="font-mono text-xs leading-relaxed text-muted-foreground">
              点选测试项查看其过程能力直方图。
            </p>
          </div>

          <div className="flex flex-col gap-4 border border-border bg-muted/40 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-foreground">{fileName}</p>
                  {dataset && (
                    <p className="mt-1 font-mono text-[0.625rem] text-muted-foreground">
                      {dataset.records} 条记录 / {dataset.columns.length} 个测试项
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={loadSample}
                className="flex shrink-0 items-center gap-1.5 border border-border px-2.5 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground active:scale-[0.98]"
              >
                <ArrowCounterClockwise className="size-3" />
                示例
              </button>
            </div>
            <FileDropZone
              id="cpk-csv-input"
              label="导入测试数据 CSV"
              description="导出格式（含规格限）或通用 CSV"
              accept=".csv,text/csv"
              file={file}
              onSelect={(f) => void handleFile(f)}
              onClear={() => setFile(null)}
            />
            {error && (
              <div role="alert" className="flex items-center gap-2 font-mono text-xs text-destructive">
                <WarningCircle className="size-4 shrink-0" />
                <span>[ 异常: {error} ]</span>
              </div>
            )}
          </div>

          {/* 测试项选择列表 */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索测试项…"
                className="awwwards-input w-full font-mono text-sm text-foreground"
              />
            </div>
            <div className="max-h-[46rem] overflow-y-auto border border-border">
              {filtered.length === 0 && (
                <p className="p-4 font-mono text-xs text-muted-foreground">[ 无匹配测试项 ]</p>
              )}
              {filtered.map(({ column, index }) => {
                const isActive = index === activeIndex && active !== null;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setSelected(index)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-transparent text-foreground hover:bg-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-px shrink-0 font-mono text-[0.625rem]',
                        isActive ? 'text-primary-foreground/70' : 'text-muted-foreground',
                      )}
                    >
                      {String(index + 1).padStart(3, '0')}
                    </span>
                    <span className="min-w-0 font-mono text-[0.6875rem] leading-snug break-words">
                      {shortName(column.name)}
                      {column.unit && <span className={cn('ml-1', isActive ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{column.unit}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* 右侧：图表区 */}
        <section className="gsap-reveal flex flex-col gap-6 lg:col-span-8">
          {active ? (
            <>
              <div className="flex flex-col gap-3 border-b border-border pb-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="border border-border bg-muted px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted-foreground">
                    {String(activeIndex + 1).padStart(3, '0')} / {dataset?.columns.length}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {active.column.unit ? `UNIT / ${active.column.unit}` : 'UNIT / —'}
                  </span>
                  {active.hasLimits && (
                    <span className="font-mono text-xs text-muted-foreground">
                      LSL {formatValue(active.column.lower ?? 0)} → USL {formatValue(active.column.upper ?? 0)}
                    </span>
                  )}
                  {cpkBadge && (
                    <span className={cn('border px-2.5 py-1 font-mono text-[0.625rem] font-bold uppercase tracking-[0.14em]', cpkBadge.tone)}>
                      {cpkBadge.text}
                    </span>
                  )}
                </div>
                <h3 className="font-mono text-lg leading-snug tracking-tight break-words text-foreground">
                  {active.column.name}
                </h3>
              </div>

              <div className="border border-border bg-background p-2 sm:p-4">
                <CpkHistogram analysis={active} />
              </div>

              <div className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
                {[
                  { label: '样本数', value: String(active.stat.count) },
                  { label: 'NA 数', value: String(active.stat.naCount) },
                  { label: '失败数', value: `${active.stat.failureCount} (${active.stat.failureRate.toFixed(2)}%)` },
                  { label: 'Cpk', value: formatIndex(active.stat.cpk) },
                  { label: 'Mean', value: formatValue(active.stat.mean) },
                  { label: 'Std. Dev.', value: formatValue(active.stat.stdDev) },
                  { label: 'Cpu', value: formatIndex(active.stat.cpu) },
                  { label: 'Cpl', value: formatIndex(active.stat.cpl) },
                ].map((m) => (
                  <div key={m.label} className="bg-background p-3">
                    <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted-foreground">
                      {m.label}
                    </p>
                    <p className="mt-1 font-mono text-sm font-bold tabular-nums text-foreground">
                      {m.value}
                    </p>
                  </div>
                ))}
              </div>

              <p className="font-mono text-[0.625rem] leading-relaxed text-muted-foreground">
                直方图纵轴为相对频率（%），红色竖线为规格限（LSL / USL）；标准差为样本标准差（ddof=1）；
                Cpk = min(Cpu, Cpl)，来自测试系统导出的同一组测量值。
              </p>
            </>
          ) : (
            <div className="flex h-96 w-full flex-col items-center justify-center border border-dashed border-border p-8 text-center">
              <ChartBar className="mb-4 size-12 text-muted-foreground opacity-40" />
              <p className="font-mono text-sm text-muted-foreground">
                [ 暂无数据 · 请上传 CSV 或加载示例数据 ]
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default CpkChartsTool;

