import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowsClockwise,
  ChartBarHorizontal,
  FilePng,
  FileSvg,
  Prohibit,
  Warning,
} from '@phosphor-icons/react';
import { gsap } from 'gsap';

import api from '../../../api/axios';
import FileDropZone from '../../../components/FileDropZone';
import { LoadingSignal } from '../../../components/LoadingSignal';
import { cn } from '../../../lib/cn';
import { useTusUpload } from '../../../hooks/useTusUpload';
import BoxPlotChart, { type BoxGroup, type BoxPlotChartHandle, type WhiskerMode } from './chart';
import { SearchableSelect } from './searchable-select';

/*
 * API 契约：
 *   POST /tools/box-plot/columns    body { upload_id } → 列类型 + 前 5 行预览
 *   POST /tools/box-plot/analyze    body { upload_id, value_col, group_col? }
 *                                    → 各分组统计量（同步，无轮询）
 * 图表渲染与 SVG/PNG 导出均在客户端完成。
 *
 * 交互设计（对照 Apple HIG）：
 * - 选文件后自动上传并预填默认列（减少决策）——Direct manipulation；
 * - 上传中可取消（Progress: allow halting）；
 * - 图表直接显示在下方，更改列后自动刷新；
 * - 「更换文件」重置上传。
 */

interface ColumnMeta {
  name: string;
  kind: 'numeric' | 'text' | 'other';
  nonNullCount: number;
}

interface ColumnsResponse {
  filename: string;
  rows: number;
  sampled: boolean;
  columns: ColumnMeta[];
  previewColumns: string[];
  previewRows: string[][];
  excludedRows: number;
}

interface AnalyzeResponse {
  filename: string;
  valueColumn: string;
  groupColumn: string | null;
  quartileMethod: string;
  whisker: 'tukey';
  totalRows: number;
  usedRows: number;
  skippedRows: number;
  groups: BoxGroup[];
}

type Phase = 'upload' | 'configure';

const NG_GROUP = '__none__';

const toCamel = <T extends Record<string, unknown>>(record: T): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    output[camel] = value;
  }
  return output;
};

const readErrorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: { detail?: string } } })?.response;
  return response?.data?.detail || '处理失败，请稍后重试';
};

const uploadStateLabel = (status: string): string => {
  switch (status) {
    case 'hashing':
      return '正在校验内容';
    case 'cache-checking':
      return '查找缓存';
    case 'uploading':
      return '正在上传';
    case 'confirming':
      return '完成中';
    case 'completed':
      return '已完成';
    case 'error':
      return '上传失败';
    default:
      return '准备中';
  }
};



const BoxPlotTool: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartHandleRef = useRef<BoxPlotChartHandle>(null);

  const [phase, setPhase] = useState<Phase>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<ColumnsResponse | null>(null);
  const [valueColumn, setValueColumn] = useState('');
  const [groupColumn, setGroupColumn] = useState<string>(NG_GROUP);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [whiskerMode, setWhiskerMode] = useState<WhiskerMode>('tukey');
  const [showValues, setShowValues] = useState(false);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const upload = useTusUpload({
    onSuccess: (uploadId) => {
      void loadColumns(uploadId);
    },
  });

  const loadColumns = useCallback(async (uploadId: string) => {
    try {
      const response = await api.post<Record<string, unknown> & ColumnsResponse>(
        '/tools/box-plot/columns',
        { upload_id: uploadId },
      );
      const raw = toCamel(response.data) as unknown as Record<string, unknown>;
      // 嵌套数组需深层转换（columns / previewRows 等仍为 snake_case）
      if (Array.isArray(raw.columns)) {
        raw.columns = (raw.columns as Record<string, unknown>[]).map((c) => toCamel(c));
      }
      const cameled = raw as unknown as ColumnsResponse;
      if (cameled.columns.length === 0) {
        setError('数据文件没有任何列');
        return;
      }
      setColumns(cameled);
      const numericNames = cameled.columns
        .filter((column) => column.kind === 'numeric')
        .map((column) => column.name);
      if (numericNames.length > 0) {
        setValueColumn(numericNames[0]);
        setGroupColumn(
          cameled.columns.find((column) => column.kind === 'text')?.name ?? NG_GROUP,
        );
      }
      setPhase('configure');
    } catch (err) {
      // 保留上传文件与 uploadId，停留当前阶段并允许重试解析
      setError(readErrorMessage(err));
    }
  }, []);

  const handleFileSelect = useCallback(
    async (selected: File) => {
      setFile(selected);
      setError('');
      setColumns(null);
      setAnalysis(null);
      setPhase('upload');
      try {
        await upload.upload({ file: selected, metadata: { filename: selected.name } });
      } catch {
        // 错误状态已由 useTusUpload 写入
      }
    },
    [upload],
  );

  const handleCancelUpload = useCallback(() => {
    upload.abort();
    setFile(null);
    setError('');
  }, [upload]);

  const handleReset = useCallback(() => {
    upload.reset();
    setFile(null);
    setColumns(null);
    setAnalysis(null);
    setError('');
    setPhase('upload');
  }, [upload]);

  const numericColumns = useMemo(
    () => (columns?.columns ?? []).filter((column) => column.kind === 'numeric'),
    [columns],
  );

  const doAnalyze = useCallback(async (valueCol: string, groupCol: string) => {
    if (!upload.uploadId || !valueCol) return;
    setError('');
    setAnalyzing(true);
    try {
      const response = await api.post<Record<string, unknown> & AnalyzeResponse>(
        '/tools/box-plot/analyze',
        {
          upload_id: upload.uploadId,
          value_col: valueCol,
          group_col: groupCol === NG_GROUP ? null : groupCol,
        },
      );
      const rawAnalyze = toCamel(response.data) as unknown as Record<string, unknown>;
      if (Array.isArray(rawAnalyze.groups)) {
        rawAnalyze.groups = (rawAnalyze.groups as Record<string, unknown>[]).map((g) => toCamel(g));
      }
      const cameled = rawAnalyze as unknown as AnalyzeResponse;
      if (cameled.groups.length === 0) {
        setError('没有可绘制的数据');
        return;
      }
      setAnalysis(cameled);
    } catch (err) {
      setError(readErrorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  }, [upload.uploadId]);

  // 列变更后自动刷新箱线图（无需点击生成按钮）
  useEffect(() => {
    if (phase !== 'configure' || !columns || !valueColumn) return;
    if (numericColumns.length === 0) return;
    void doAnalyze(valueColumn, groupColumn);
  }, [phase, columns, valueColumn, groupColumn, numericColumns.length, doAnalyze]);

  useEffect(() => {
    if (
      !containerRef.current ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
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
  }, [phase]);

  const handleExport = useCallback(
    async (format: 'svg' | 'png') => {
      if (!analysis || !chartHandleRef.current) return;
      const baseName = `${(analysis.filename || 'boxplot').replace(/\.[^.]+$/, '')}-boxplot`;
      setExporting(true);
      try {
        if (format === 'svg') {
          chartHandleRef.current.exportSvg(baseName);
        } else {
          await chartHandleRef.current.exportPng(baseName);
        }
      } catch {
        setError('导出失败，请稍后重试');
      } finally {
        setExporting(false);
      }
    },
    [analysis],
  );

  const isUploadBusy = [
    'hashing',
    'cache-checking',
    'uploading',
    'confirming',
  ].includes(upload.status);
  const isUploadDone = upload.status === 'completed' && upload.uploadId !== null;

  return (
    <div
      ref={containerRef}
      className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto"
    >
      {error && (
        <div
          role="alert"
          className="mb-8 flex flex-wrap items-center gap-4 border border-status-danger-foreground/40 bg-status-danger-surface px-5 py-4"
        >
          <Warning weight="fill" className="size-5 shrink-0 text-status-danger-foreground" />
          <p className="font-mono text-xs uppercase tracking-widest text-status-danger-foreground">
            [ 异常: {error} ]
          </p>
          {isUploadDone && phase === 'upload' && (
            <button
              type="button"
              onClick={() => {
                void loadColumns(upload.uploadId!);
              }}
              className="ml-auto font-mono text-xs uppercase tracking-widest text-status-danger-foreground underline underline-offset-4 transition-opacity hover:opacity-70"
            >
              重试解析
            </button>
          )}
        </div>
      )}

      {/* 阶段 1：上传 */}
      {phase === 'upload' && (
        <section className="gsap-reveal grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary">
                  [ 01 · 数据源 ]
                </p>
                <h2 className="text-[22px] font-bold tracking-tight md:text-[26px] leading-[1.15]">
                  {isUploadDone ? '上传完成' : '上传数据文件'}
                </h2>
              </div>
              {isUploadBusy && (
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-primary"
                >
                  <Prohibit weight="bold" className="size-4" />
                  取消上传
                </button>
              )}
            </div>
            <FileDropZone
              id="box-plot-file"
              label="数据文件 (CSV / XLSX / XLS)"
              description="每行一条记录；数值列可含文本脏值（自动跳过）；支持 UTF-8 与 GB18030 编码"
              accept=".csv,.xlsx,.xls"
              file={file}
              onSelect={(selected) => {
                void handleFileSelect(selected);
              }}
              onClear={isUploadBusy ? undefined : handleReset}
              disabled={isUploadBusy}
            />
          </div>
          <div className="flex min-h-[20rem] flex-col justify-center border-l-2 border-border pl-8 md:pl-12 lg:border-l-0 lg:pl-0">
            {isUploadBusy ? (
              <LoadingSignal
                ariaLabel="数据文件上传中"
                meta="Box / Upload"
                label={`[ 数据文件 · ${uploadStateLabel(upload.status)} ]`}
                detail={
                  upload.status === 'uploading'
                    ? `${Math.round(upload.progress)}% · ${upload.bytesSent} / ${upload.bytesTotal} 字节`
                    : '正在传输数据文件'
                }
              />
            ) : (
              <div>
                <p className="mb-4 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                  输出流 (Output Stream)
                </p>
                <p className="text-2xl font-bold uppercase tracking-tighter text-border leading-none">
                  等待
                  <br />
                  数据
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 阶段 2：列配置（含数据预览） */}
      {phase === 'configure' && columns && (
        <section className="gsap-reveal">
          <div className="mb-6 border-b border-border pb-5">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary">
                  [ 02 · 列配置 ]
                </p>
                <h2 className="text-[22px] font-bold tracking-tight md:text-[26px] leading-[1.15]">
                  选择数值列与分组列
                </h2>
                <p className="mt-4 max-w-2xl font-mono text-xs text-muted-foreground">
                  {columns.filename} · {columns.rows.toLocaleString('zh-CN')} 行
                  {columns.sampled ? ' · 列类型基于前 10,000 行推断' : ''}
                  {columns.excludedRows > 0
                    ? ` · 已自动排除 ${columns.excludedRows} 行规格行（上限/下限/单位）`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-primary"
              >
                <ArrowsClockwise weight="bold" className="size-4" />
                更换文件
              </button>
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <label className="flex flex-col gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                数值列 (Value)
              </span>
              <SearchableSelect
                value={valueColumn}
                onValueChange={setValueColumn}
                options={numericColumns.map((c) => ({ value: c.name, label: c.name }))}
                placeholder="选择数值列"
                searchPlaceholder="搜索数值列..."
                emptyText="无匹配数值列"
                ariaLabel="数值列"
              />
              {numericColumns.length === 0 && (
                <p className="font-mono text-[0.625rem] uppercase tracking-widest text-primary">
                  [ 未检测到数值列 ]
                </p>
              )}
            </label>

            <label className="flex flex-col gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                分组列 (Group · 可选)
              </span>
              <SearchableSelect
                value={groupColumn}
                onValueChange={setGroupColumn}
                options={[
                  { value: NG_GROUP, label: "不分组（单箱对比）" },
                  ...columns.columns.map((c) => ({ value: c.name, label: c.name })),
                ]}
                placeholder="选择分组列"
                searchPlaceholder="搜索分组列..."
                emptyText="无匹配分组列"
                ariaLabel="分组列"
              />
            </label>
          </div>
          {analyzing && (
            <p className="mt-6 font-mono text-[0.625rem] uppercase tracking-widest text-primary">
              统计计算中…
            </p>
          )}

          {/* 箱线图直接显示在下方，更改列后自动刷新 */}
          <div className="mt-10 border-t border-border pt-6">
            {analyzing && !analysis && (
              <div className="flex min-h-48 items-center justify-center">
                <LoadingSignal
                  ariaLabel="箱线图统计计算中"
                  meta="Box / Statistics"
                  label="[ 统计计算 · 进行中 ]"
                  detail="按分组计算五数概括与离群点"
                />
              </div>
            )}
            {analysis && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
                  <div>
                    <p className="mb-1 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-primary">
                      [ 分布对比 ]
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {analysis.filename} · {analysis.valueColumn}
                      {analysis.groupColumn ? ` · 按 ${analysis.groupColumn} 分组` : ' · 单箱对比'} · 有效{' '}
                      {analysis.usedRows.toLocaleString('zh-CN')} / {analysis.totalRows.toLocaleString('zh-CN')} 行
                      {analysis.skippedRows > 0 ? ` · 跳过 ${analysis.skippedRows.toLocaleString('zh-CN')} 行` : ''} · 分位数{' '}
                      {analysis.quartileMethod}
                      {analyzing && <span className="ml-2 text-primary">· 刷新中…</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-1 border border-border p-1 font-mono text-[0.625rem] uppercase tracking-[0.16em]">
                      {(['tukey', 'minmax'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setWhiskerMode(mode)}
                          aria-pressed={whiskerMode === mode}
                          className={cn(
                            'px-3 py-1.5 transition-colors',
                            whiskerMode === mode
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {mode === 'tukey' ? 'Tukey' : 'Min-Max'}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowValues((v) => !v)}
                      aria-pressed={showValues}
                      className={cn(
                        'border px-3 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.16em] transition-colors',
                        showValues
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      显示数值标签
                    </button>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          void handleExport('svg');
                        }}
                        disabled={exporting}
                        className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                      >
                        <FileSvg weight="bold" className="size-4" />
                        SVG
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleExport('png');
                        }}
                        disabled={exporting}
                        className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                      >
                        <FilePng weight="bold" className="size-4" />
                        PNG
                      </button>
                    </div>
                  </div>
                </div>
                                <div className="border border-border bg-card p-3 md:p-4">
                  <BoxPlotChart ref={chartHandleRef} groups={analysis.groups} whiskerMode={whiskerMode} showValues={showValues} />
                </div>
                <div>
                  <p className="mb-6 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                    统计摘要 (Summary)
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[40rem] border-collapse font-mono text-[11px] tabular-nums">
                      <thead>
                        <tr className="border-b border-border text-left uppercase tracking-[0.12em] text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">分组</th>
                          <th className="px-2 py-2 font-medium">n</th>
                          <th className="px-2 py-2 font-medium">MIN</th>
                          <th className="px-2 py-2 font-medium">Q1</th>
                          <th className="px-2 py-2 font-medium">中位数</th>
                          <th className="px-2 py-2 font-medium">Q3</th>
                          <th className="px-2 py-2 font-medium">MAX</th>
                          <th className="px-2 py-2 font-medium">IQR</th>
                          <th className="px-2 py-2 font-medium">离群点</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.groups.map((group) => (
                          <tr
                            key={group.name}
                            className="border-b border-border text-foreground transition-colors hover:bg-primary/5"
                          >
                            <td className="max-w-64 truncate py-2 pr-4 font-semibold" title={group.name}>
                              {group.name}
                            </td>
                            <td className="px-2 py-2">{group.count}</td>
                            <td className="px-2 py-2">{group.min}</td>
                            <td className="px-2 py-2">{group.q1}</td>
                            <td className="px-2 py-2 text-primary">{group.median}</td>
                            <td className="px-2 py-2">{group.q3}</td>
                            <td className="px-2 py-2">{group.max}</td>
                            <td className="px-2 py-2">{group.iqr}</td>
                            <td className="px-2 py-2">{group.outlierCount > 0 ? group.outlierCount : '·'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-4 flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-widest text-muted-foreground">
                    <ChartBarHorizontal weight="bold" className="size-4" />
                    悬停箱体查看精确统计 · 导出前请确认数据不含敏感信息
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default BoxPlotTool;
