import axios from 'axios';
import {
  AlertTriangle,
  BarChart3,
  CircleCheck,
  Download,
  FolderOpen,
  FolderTree,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AsyncZipDeflate, Zip } from 'fflate';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { MAX_UPLOAD_BYTES } from '@/config/limits';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import api from '../../../api/axios';
import { LoadingSignal } from '../../../components/LoadingSignal';
import { formatTime, parseServerDate } from '../../../lib/format-time';
import {
  type UploadState,
  useTusUpload,
} from '../../../hooks/useTusUpload';

/*
 * API 契约（异步合并，后端并行改造中）：
 *   POST   /tools/atlas-merge/analyze            body { upload_id } → 202 { job_id }
 *   GET    /tools/atlas-merge/jobs/{job_id}      轮询合并进度（见 AtlasMergeJobResponse）
 *   GET    /tools/atlas-merge/results/{id}/download   → CSV 文件
 *   DELETE /tools/atlas-merge/results/{id}
 * 后端预览上限：PREVIEW_MEASUREMENT_COLUMNS=20、PREVIEW_ROWS=10，
 * 完整数据（上千测量列）走 download 端点。
 */

interface AtlasMergeAnalysis {
  result_id: string;
  download_filename: string;
  expires_at: string;
  /** 产出数据行的 unit 数（按 SerialNumber 去重） */
  unit_count: number;
  /** 总行数（每个 unit 的每次 run 一行） */
  run_count: number;
  /** 数据文件读取失败的记录，如 "JMV001 [run 2]: 数据文件读取失败" */
  parse_errors: string[];
  /** 实际使用的数据来源（System / User） */
  data_source: string;
  /** 固定 8 个元数据列名，恒显示 */
  metadata_columns: string[];
  /** 前 N 个测量列名（预览用，可勾选显示） */
  preview_measurement_columns: string[];
  /** 测量列总数（含未进预览的列，可能上千） */
  total_measurement_columns: number;
  /** 元数据列 + 前 N 个测量列，前端表格骨架，rows_preview 与其对齐 */
  columns: string[];
  /** 前 N 行预览数据 */
  rows_preview: string[][];
}

type AtlasMergeJobStatus = 'queued' | 'running' | 'done' | 'error';

/** queued / running：done/total 为已合并 unit 数 / 总 unit 数。 */
interface AtlasMergeJobProgress {
  status: Extract<AtlasMergeJobStatus, 'queued' | 'running'>;
  done: number;
  total: number;
}

/** done：与 AtlasMergeAnalysis 字段一致，仅多一个 status。 */
interface AtlasMergeJobDone extends AtlasMergeAnalysis {
  status: 'done';
}

interface AtlasMergeJobError {
  status: 'error';
  error: string;
}

type AtlasMergeJobResponse =
  | AtlasMergeJobProgress
  | AtlasMergeJobDone
  | AtlasMergeJobError;

type Phase = 'upload' | 'analyzing' | 'ready';

/** 导出格式：pivot_to_wide 兼容既有脚本；insight 为 HILO Export-ID 标准布局 */
type ExportFormat = 'pivot_to_wide' | 'insight';
type AnalyzeStep = 'packing' | 'uploading' | 'processing';

/** 合并进度轮询间隔（ms）。 */
const POLL_INTERVAL_MS = 1600;
/** 连续轮询网络失败上限，超过即停止并提示（避免无限轮询）。 */
const MAX_POLL_FAILURES = 3;

/** 判断查询错误是否为「任务已不存在」：404 未找到、410 已过期。 */
const isJobGoneError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const status = (error as { response?: { status?: number } }).response?.status;
  return status === 404 || status === 410;
};

interface SelectedFile {
  file: File;
  /** webkitRelativePath，保留 unit/run/system|user 目录结构 */
  path: string;
}

interface ArchiveStats {
  rootName: string;
  units: string[];
  runs: string[];
  files: SelectedFile[];
  totalBytes: number;
  excludedCount: number;
  excludedBytes: number;
}

const NUMBER_FORMATTER = new Intl.NumberFormat('zh-CN');

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
};

/**
 * 合并白名单：后端合并逻辑只认这 3 类 CSV，其余（device.log、*.plist、
 * Datalogger/*.csv、*_flow.log 等）一律不打包——
 * 这是上传体积从 GB 级降到百 MB 级的关键。
 *
 * 匹配规则（与 backend/app/services/atlas_merge/merge_engine.py 对齐）：
 * 1. 以 system/time.csv 结尾
 * 2. 以 system/records.csv 结尾
 * 3. 以 _pivot.csv 结尾，且倒数第二段是 user（即 user/<unit>_pivot.csv，
 *    pivot 文件直接位于 run 的 user/ 子目录下）
 */
const isMergeCsv = (relativePath: string): boolean => {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.endsWith('system/time.csv')) {
    return true;
  }
  if (normalized.endsWith('system/records.csv')) {
    return true;
  }
  const segments = normalized.split('/');
  return (
    segments[segments.length - 1]?.endsWith('_pivot.csv') === true &&
    segments[segments.length - 2] === 'user'
  );
};

/** macOS 元数据文件（任意层级），不参与统计与打包。 */
const isMacMetadataFile = (basename: string): boolean =>
  basename === '.DS_Store';

/** 从文件列表中提取统计信息与白名单文件，不入库、纯前端计算。 */
const computeArchive = (files: File[]): ArchiveStats => {
  const selected: SelectedFile[] = [];
  const rootSet = new Set<string>();
  const unitSet = new Set<string>();
  const runSet = new Set<string>();
  let totalBytes = 0;
  let excludedCount = 0;
  let excludedBytes = 0;

  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const segments = path.replace(/\\/g, '/').split('/');
    // 跳过 macOS 元数据文件：不进 selected / excluded，也不污染 unit/run 统计
    if (isMacMetadataFile(segments[segments.length - 1] ?? '')) {
      continue;
    }
    const unit = segments.length > 1 ? segments[1] : segments[0];
    const run = segments.length > 2 ? `${segments[1]}/${segments[2]}` : unit;
    if (segments.length > 1) {
      rootSet.add(segments[0]);
      unitSet.add(unit);
      runSet.add(run);
    } else {
      unitSet.add(unit);
      runSet.add(unit);
    }

    if (isMergeCsv(path)) {
      selected.push({ file, path });
      totalBytes += file.size;
    } else {
      excludedCount += 1;
      excludedBytes += file.size;
    }
  }

  return {
    rootName: files[0]?.webkitRelativePath.split('/')[0] || 'unit-archive',
    units: Array.from(unitSet),
    runs: Array.from(runSet),
    files: selected,
    totalBytes,
    excludedCount,
    excludedBytes,
  };
};

/**
 * 打包 zip：逐文件「读入 → 压缩 → 释放」，不在内存里同时持有全部原始字节。
 * fflate 的 Zip + AsyncZipDeflate 是流式压缩（异步 DEFLATE 在 Worker 中执行），
 * 每读完一个 CSV 就 push 进压缩流并释放该文件引用，峰值内存从
 * 「全部原始字节 + 完整压缩产物」降到「单个文件 + 压缩产物」。
 */
const buildArchive = async (
  files: SelectedFile[],
  zipName: string,
  onReadProgress: (readCount: number) => void,
): Promise<File> => {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let completed = false;
  let zipError: Error | null = null;

  const zipStream = new Zip((error, data, final) => {
    if (error) {
      if (!completed) {
        completed = true;
        zipError = error;
      }
      return;
    }
    if (data && data.length > 0) {
      chunks.push(data);
    }
    if (final) {
      completed = true;
    }
  });

  // 每个文件一条独立 deflate 流，全部结束后才写中央目录（zip.end()）
  let pending = 0;
  // 循环里有 await（逐个读文件），期间先入队的 entry 可能已经压完。若只看 pending，
  // 就会在还有文件没入队时提前 end()，后续 add() 抛错或产出截断的 zip。
  let allQueued = false;
  const endArchive = () => {
    if (allQueued && pending === 0 && !completed) {
      // end() 必须等当前一轮 add/ondata 回调栈退出后调用：否则 fflate 会把
      // 中央目录的写入推迟到下一次 add，而 end() 之后不再有 add，归档永远不结束
      queueMicrotask(() => zipStream.end());
    }
  };

  for (let index = 0; index < files.length; index += 1) {
    const { file, path } = files[index];
    const bytes = new Uint8Array(await file.arrayBuffer());
    onReadProgress(index + 1);

    const entry = new AsyncZipDeflate(path, { level: 6 });
    zipStream.add(entry);
    // 保存 Zip 注册的 ondata（负责写 header / CRC / 压缩数据），在其之上叠加计数
    const archiveHandler = entry.ondata;
    entry.ondata = (error, data, final) => {
      archiveHandler(error, data, final);
      if (final) {
        pending -= 1;
        endArchive();
      }
    };
    pending += 1;
    entry.push(bytes, true);
  }
  // 全部文件都入队了才允许关档；空列表（files 为空）同样在这里兜底
  allQueued = true;
  endArchive();

  await new Promise<void>((resolve, reject) => {
    const timer = window.setInterval(() => {
      if (zipError) {
        window.clearInterval(timer);
        reject(zipError);
        return;
      }
      if (completed) {
        window.clearInterval(timer);
        resolve();
      }
    }, 16);
  });

  // 压缩产物只保留这一份；原始文件字节已在循环里逐个释放
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new File([merged], zipName, { type: 'application/zip' });
};

type UploadProgressState = Pick<
  UploadState,
  | 'status'
  | 'progress'
  | 'acceptedProgress'
  | 'bytesSent'
  | 'bytesAccepted'
  | 'bytesTotal'
  | 'cacheHit'
>;

const UploadProgressRow: React.FC<{
  label: string;
  upload: UploadProgressState;
}> = ({ label, upload }) => {
  const isHashing = upload.status === 'hashing';
  const isCheckingCache = upload.status === 'cache-checking';
  const isCompleting = upload.status === 'confirming';
  const isCompleted = upload.status === 'completed';

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">
          {label}
        </span>
        <span className="inline-flex items-center gap-2 text-xs tabular-nums">
          {isCompleted ? (
            <>
              <CircleCheck className="size-4 text-primary" />
              {upload.cacheHit ? '已使用缓存' : '已完成'}
            </>
          ) : isHashing ? (
            '正在校验'
          ) : isCheckingCache ? (
            '查找缓存'
          ) : isCompleting ? (
            <>
              <span
                aria-hidden="true"
                className="size-2 bg-primary motion-safe:animate-pulse"
              />
              完成中
            </>
          ) : (
            `${upload.progress}%`
          )}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            'h-full rounded-full bg-primary transition-all duration-300 ease-out',
            isCompleting && 'motion-safe:animate-pulse',
          )}
          style={{ width: `${upload.progress}%` }}
        />
      </div>
      {upload.bytesTotal > 0 && upload.bytesAccepted > 0 && !isCompleted && (
        <p className="mt-2 text-[0.625rem] tabular-nums text-muted-foreground">
          已确认 {formatBytes(upload.bytesAccepted)} / {formatBytes(upload.bytesTotal)}
        </p>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number }> = ({
  label,
  value,
}) => (
  <div className="border-t pt-4">
    <p className="text-xs text-muted-foreground">
      {label}
    </p>
    <p className="mt-2 text-2xl font-semibold tabular-nums">
      {NUMBER_FORMATTER.format(value)}
    </p>
  </div>
);

/** 合并进度：running 显示真实 unit 级进度条，queued 显示排队中持续状态。 */
const MergeProgress: React.FC<{ progress: AtlasMergeJobProgress | null }> = ({
  progress,
}) => {
  if (!progress || progress.status === 'queued') {
    return (
      <LoadingSignal
        ariaLabel="合并任务排队中"
        meta="Atlas / Merge"
        label="[ 测试日志 · 排队中 ]"
        detail="等待其他合并任务完成，请稍候"
        className="mb-8"
      />
    );
  }

  const { done, total } = progress;
  const percent =
    total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;

  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">
          合并 {NUMBER_FORMATTER.format(done)} / {NUMBER_FORMATTER.format(total)} units
        </span>
        <span className="text-xs tabular-nums">
          {percent}%
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        正在合并测试日志，请勿关闭页面
      </p>
    </div>
  );
};

const AnalysisInProgress: React.FC<{
  rootName: string;
  fileCount: number;
  totalBytes: number;
  upload: UploadProgressState;
  step: AnalyzeStep;
  packReadCount: number;
  isCompressing: boolean;
  jobProgress: AtlasMergeJobProgress | null;
}> = ({
  rootName,
  fileCount,
  totalBytes,
  upload,
  step,
  packReadCount,
  isCompressing,
  jobProgress,
}) => {
  const isPacking = step === 'packing';

  return (
    <section className="flex min-h-96 flex-col justify-start gap-8 rounded-xl border bg-card p-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs text-muted-foreground">
            {step === 'processing'
              ? '合并中'
              : step === 'uploading'
                ? '上传中'
                : '打包中'}
          </p>
          <h2 className="mt-1 text-lg font-medium tracking-tight">
            {step === 'processing'
              ? '正在合并测试日志'
              : step === 'uploading'
                ? '正在上传日志归档'
                : '正在整理日志文件'}
          </h2>
        </div>
        <FolderTree className="size-6 shrink-0 text-muted-foreground" />
      </div>

      <div>
        {isPacking ? (
          <LoadingSignal
            ariaLabel="正在打包日志归档"
            meta="Atlas / Archive"
            label={isCompressing ? '[ 日志归档 · 压缩中 ]' : '[ 日志归档 · 读取中 ]'}
            detail={
              isCompressing
                ? `正在压缩 ${NUMBER_FORMATTER.format(fileCount)} 个 CSV 文件`
                : `已读取 ${NUMBER_FORMATTER.format(packReadCount)} / ${NUMBER_FORMATTER.format(fileCount)} 个文件`
            }
            className="mb-8"
          />
        ) : step === 'uploading' ? (
          <div className="mb-12 flex flex-col gap-6">
            <UploadProgressRow label="日志归档 zip" upload={upload} />
          </div>
        ) : (
          <MergeProgress progress={jobProgress} />
        )}

        <dl className="grid gap-5 border-t pt-6 text-xs md:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-muted-foreground">
              归档目录
            </dt>
            <dd className="mt-2 break-words text-foreground">{rootName}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">
              CSV 文件
            </dt>
            <dd className="mt-2 break-words text-foreground">
              {NUMBER_FORMATTER.format(fileCount)} 个 ·{' '}
              {formatBytes(totalBytes)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">
              归档体积
            </dt>
            <dd className="mt-2 break-words text-foreground">
              {step === 'uploading' && upload.bytesTotal > 0
                ? formatBytes(upload.bytesTotal)
                : '—'}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
};

/** 解析错误横幅：展示合并过程中失败的文件记录，不阻断结果。 */
const ParseErrorBanner: React.FC<{ errors: string[] }> = ({ errors }) => {
  if (!errors.length) {
    return null;
  }

  return (
    <section
      role="alert"
      aria-label="解析错误"
      className="mt-8 rounded-xl border border-status-danger-foreground/40 bg-status-danger-surface p-6"
    >
      <div className="flex items-start gap-4">
        <AlertTriangle
          className="mt-1 size-5 shrink-0 text-status-danger-foreground"
        />
        <div className="min-w-0">
          <h3 className="font-medium text-status-danger-foreground">
            部分文件解析失败
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-status-danger-foreground/80">
            合并结果仍可用，但以下 {NUMBER_FORMATTER.format(errors.length)} 个文件
            未计入，请核对后重新分析。
          </p>
          <ul className="mt-5 grid gap-3">
            {errors.map((message, index) => (
              <li
                key={`${message}-${index}`}
                className="break-words border-t border-status-danger-foreground/20 pt-3 text-xs text-status-danger-foreground/80"
              >
                {message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};


const parseDownloadFilename = (
  contentDisposition: string | undefined,
  fallback: string,
) => {
  const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
  return encodedMatch ? decodeURIComponent(encodedMatch[1]) : fallback;
};

const readErrorMessage = async (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return '处理失败，请稍后重试';
  }

  const responseData = error.response?.data;
  if (responseData instanceof Blob) {
    try {
      const parsed = JSON.parse(await responseData.text());
      return parsed.detail || '处理失败，请检查上传文件';
    } catch {
      return '处理失败，请检查上传文件';
    }
  }

  return responseData?.detail || error.message || '处理失败，请稍后重试';
};

const AtlasMerge: React.FC = () => {
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const isAnalyzingRef = useRef(false);

  const [stats, setStats] = useState<ArchiveStats | null>(null);
  const [phase, setPhase] = useState<Phase>('upload');
  const [analyzeStep, setAnalyzeStep] = useState<AnalyzeStep>('packing');
  const [packReadCount, setPackReadCount] = useState(0);
  const [isCompressing, setIsCompressing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<AtlasMergeJobProgress | null>(
    null,
  );
  const [analysis, setAnalysis] = useState<AtlasMergeAnalysis | null>(null);
  const [error, setError] = useState('');
  /** 轮询瞬时失败的可重试提示：非空时保留 jobId 与 analyzing 阶段，不退回上传 */
  const [pollRetryMessage, setPollRetryMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pivot_to_wide');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isExpired, setIsExpired] = useState(false);

  const archiveUpload = useTusUpload();

  useEffect(() => {
    if (!analysis?.expires_at) {
      setIsExpired(false);
      return;
    }

    const expiresIn = (parseServerDate(analysis.expires_at)?.getTime() ?? 0) - Date.now();
    if (expiresIn <= 0) {
      setIsExpired(true);
      return;
    }

    setIsExpired(false);
    const timeout = window.setTimeout(() => setIsExpired(true), expiresIn);
    return () => window.clearTimeout(timeout);
  }, [analysis]);

  // 合并任务轮询：react-query 承担请求调度与竞态控制（组件卸载/阶段切换自动停止），
  // 语义与手写轮询一致：1.6s 节奏、连续失败上限、404 立即终止、终态停止。
  const pollingEnabled =
    phase === 'analyzing' && analyzeStep === 'processing' && jobId !== null;

  // 连续轮询失败次数自己记：TanStack Query 的 fetchFailureCount 是「单次 fetch」的
  // 失败计数（retry: false 时每次都是 1），不跨轮累加，拿它做上限判断永远不会触发
  const pollFailureCountRef = useRef(0);
  const [pollFailureCount, setPollFailureCount] = useState(0);
  // 每次失败都会刷新 errorUpdatedAt，用它保证每轮只计一次
  const lastPollErrorAtRef = useRef(0);
  // 开新任务 / 任务丢失 / 轮询恢复成功都要清零：否则上一任务攒到阈值的计数会
  // 让下一任务的第一次瞬时抖动就被判成"已达上限"，直接停掉自动轮询
  const resetPollFailures = useCallback(() => {
    pollFailureCountRef.current = 0;
    lastPollErrorAtRef.current = 0;
    setPollFailureCount(0);
    setPollRetryMessage('');
  }, []);

  const jobQuery = useQuery({
    queryKey: ['atlas-merge-job', jobId],
    queryFn: async ({ queryKey }) => {
      const [, id] = queryKey;
      const response = await api.get<AtlasMergeJobResponse>(
        `/tools/atlas-merge/jobs/${id}`,
      );
      return response.data;
    },
    enabled: pollingEnabled,
    refetchInterval: (query) => {
      if (!pollingEnabled) {
        return false;
      }
      const data = query.state.data;
      // 终态（done/error）到达后停止轮询
      if (data && (data.status === 'done' || data.status === 'error')) {
        return false;
      }
      // 任务不存在/过期（404/410）立即终止，不等失败上限
      if (isJobGoneError(query.state.error)) {
        return false;
      }
      // 连续失败达到上限后停止。注意不能用 query.state.fetchFailureCount：
      // retry:false 时它每次 fetch 都从 0 重新记，恒为 1，永远到不了上限
      if (pollFailureCountRef.current >= MAX_POLL_FAILURES) {
        return false;
      }
      return POLL_INTERVAL_MS;
    },
    retry: false,
  });

  // 成功轮询的分发：queued/running 更新进度，done/error 迁移阶段。
  useEffect(() => {
    if (!pollingEnabled || !jobQuery.data) {
      return;
    }
    switch (jobQuery.data.status) {
      case 'queued':
        setJobProgress({ status: 'queued', done: 0, total: 0 });
        return;
      case 'running':
        setJobProgress({
          status: 'running',
          done: jobQuery.data.done,
          total: jobQuery.data.total,
        });
        return;
      case 'done':
        setAnalysis(jobQuery.data);
        setPhase('ready');
        return;
      case 'error':
        setError(jobQuery.data.error || '合并任务失败，请重新分析');
        setPhase('upload');
        return;
    }
  }, [pollingEnabled, jobQuery.data]);

  // 轮询失败的分发。连续失败次数用上面的自有计数（react-query 的计数不跨轮累加）：
  // - 404/410：任务确已丢失/过期，退回上传阶段；
  // - 其它错误（网络抖动、5xx）逐次累加，达上限后停止轮询并提示可重试，
  //   但保留 jobId 与 analyzing 阶段，绝不把用户推回上传页重传数百 MB。
  useEffect(() => {
    if (!pollingEnabled || !jobQuery.isError || !jobQuery.error) {
      return;
    }
    const queryError = jobQuery.error;
    if (isJobGoneError(queryError)) {
      setError('合并任务已丢失或过期，请重新分析');
      setPhase('upload');
      resetPollFailures();
      return;
    }
    // errorUpdatedAt 每失败一次都会变，用它保证每轮只计一次
    if (lastPollErrorAtRef.current === jobQuery.errorUpdatedAt) {
      return;
    }
    lastPollErrorAtRef.current = jobQuery.errorUpdatedAt;
    pollFailureCountRef.current += 1;
    setPollFailureCount(pollFailureCountRef.current);
    if (pollFailureCountRef.current < MAX_POLL_FAILURES) {
      return;
    }
    const message = queryError.message || '无法获取合并进度，请稍后重试';
    setPollRetryMessage((prev) => (prev === message ? prev : message));
  }, [
    pollingEnabled,
    jobQuery.isError,
    jobQuery.error,
    jobQuery.errorUpdatedAt,
    resetPollFailures,
  ]);

  // 轮询恢复成功即清零计数，重试横幅随之消失
  useEffect(() => {
    if (!pollingEnabled || jobQuery.isError || !jobQuery.data) {
      return;
    }
    resetPollFailures();
  }, [pollingEnabled, jobQuery.isError, jobQuery.data, resetPollFailures]);

  const handleDirectoryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    setStats(computeArchive(files));
    setError('');
    // 重置 input 以便再次选择同一目录
    event.target.value = '';
  };

  const handleAnalyze = async () => {
    if (isAnalyzingRef.current) {
      return;
    }
    if (!stats || !stats.files.length) {
      setError('请先选择 unit-archive 目录，且目录中需包含可合并的 CSV 文件');
      return;
    }
    setError('');
    // 开新任务前把上一任务的轮询失败计数清零，否则新任务第一次瞬时抖动就会被
    // 判成"已达失败上限"，直接停掉自动轮询
    resetPollFailures();
    setAnalysis(null);
    setDownloadError('');
    setJobId(null);
    setJobProgress(null);
    setPhase('analyzing');
    setAnalyzeStep('packing');
    setPackReadCount(0);
    setIsCompressing(false);
    isAnalyzingRef.current = true;
    // analyze 成功后置位：此后任何异常都不再退回上传页
    let jobAccepted = false;

    try {
      const zipName = `${stats.rootName}-atlas-merge.zip`;
      const zipFile = await buildArchive(stats.files, zipName, (count) => {
        setPackReadCount(count);
      });
      // 后端 MAX_UPLOAD_BYTES 限的是 tus 上传物（这个压缩包），不是未压缩的 CSV 总量。
      // CSV 压缩比很高，按原始体积预判会把"压缩后远低于上限"的大批量批次误拦。
      if (zipFile.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          `归档压缩后体积 ${formatBytes(zipFile.size)} 超过上限 ${formatBytes(MAX_UPLOAD_BYTES)}，`
          + '请先按 unit 拆分为多个目录分批合并',
        );
      }
      setIsCompressing(true);

      setAnalyzeStep('uploading');
      const uploadId = await archiveUpload.upload({
        file: zipFile,
        metadata: { filename: zipFile.name },
      });

      // 异步合并：analyze 返回 job_id，结果由轮询 jobs/{job_id} 获取
      setAnalyzeStep('processing');
      const response = await api.post<{ job_id: string }>(
        '/tools/atlas-merge/analyze',
        { upload_id: uploadId, export_format: exportFormat },
      );
      jobAccepted = true;
      setJobId(response.data.job_id);
      setJobProgress({ status: 'queued', done: 0, total: 0 });
    } catch (requestError) {
      // 接口未就绪（404）与外层错误都只在上传/提交阶段退回上传页；
      // 只要 analyze 已返回 job_id（jobAccepted），任务就已提交，后续交给
      // 轮询的失败分发处理，保留 jobId 让用户可以继续等待或重新查询
      if (
        axios.isAxiosError(requestError) &&
        requestError.response?.status === 404
      ) {
        setError(
          '分析接口尚未就绪（404）：后端未提供 /tools/atlas-merge/analyze，请确认后端已部署 atlas-merge 端点',
        );
      } else {
        setError(await readErrorMessage(requestError));
      }
      if (!jobAccepted) {
        setPhase('upload');
      }
    } finally {
      isAnalyzingRef.current = false;
    }
  };

  const handleDownload = async () => {
    if (!analysis || isExpired) {
      setDownloadError('下载结果已过期，请重新分析');
      return;
    }

    setDownloadError('');
    setIsDownloading(true);
    try {
      const response = await api.get<Blob>(
        `/tools/atlas-merge/results/${analysis.result_id}/download`,
        { responseType: 'blob' },
      );
      const filename = parseDownloadFilename(
        response.headers['content-disposition'],
        analysis.download_filename,
      );
      const downloadUrl = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (requestError) {
      if (
        axios.isAxiosError(requestError) &&
        requestError.response?.status === 410
      ) {
        setIsExpired(true);
      }
      setDownloadError(await readErrorMessage(requestError));
    } finally {
      setIsDownloading(false);
    }
  };

  /** 删除服务端结果，并回到上传阶段（保留已选目录）。 */
  const handleDeleteResult = async () => {
    // 重入守卫：删除进行中直接返回，避免双击重复触发
    if (!analysis || isBusy) {
      return;
    }

    setIsBusy(true);
    setDownloadError('');
    try {
      await api.delete(`/tools/atlas-merge/results/${analysis.result_id}`);
    } catch (requestError) {
      setDownloadError(await readErrorMessage(requestError));
      return;
    } finally {
      setIsBusy(false);
    }

    setAnalysis(null);
    setIsExpired(false);
    setJobId(null);
    setJobProgress(null);
    setPhase('upload');
  };

  /** 重新分析：先删除旧结果（尽力而为），再回到上传阶段。 */
  const handleReset = () => {
    if (analysis) {
      void api
        .delete(`/tools/atlas-merge/results/${analysis.result_id}`)
        .catch(() => undefined);
    }
    setAnalysis(null);
    setError('');
    setDownloadError('');
    setIsExpired(false);
    setJobId(null);
    setJobProgress(null);
    setPhase('upload');
  };

  const visibleUnits = stats?.units.slice(0, 8) ?? [];
  const hiddenUnitCount = Math.max(0, (stats?.units.length ?? 0) - 8);

  return (
    <div className="flex w-full flex-col">
      <div>
        {phase === 'upload' && (
          <>
            <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="atlas-archive-title">
              <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
                <div className="min-w-0 p-6">
                  <p className="text-xs text-muted-foreground">
                    {stats ? `${stats.units.length} units · ${stats.runs.length} runs` : '尚未选择目录'}
                  </p>
                  <h2
                    id="atlas-archive-title"
                    className="mt-1 text-lg font-medium tracking-tight"
                  >
                    选择测试日志目录
                  </h2>

                  <input
                    ref={directoryInputRef}
                    type="file"
                    className="sr-only"
                    multiple
                    // @ts-expect-error webkitdirectory 是非标准属性，用于目录选择
                    webkitdirectory=""
                    onChange={handleDirectoryChange}
                    aria-label="选择 unit-archive 目录"
                  />
                  <button
                    type="button"
                    onClick={() => directoryInputRef.current?.click()}
                    className="mt-6 flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border border-dashed px-6 text-left transition-colors hover:border-primary hover:bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {stats ? stats.rootName : '选择 unit-archive 目录'}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {stats
                          ? '点击重新选择目录'
                          : 'unit 目录 → run 目录 → system/ 与 user/ 子目录'}
                      </span>
                    </span>
                    <FolderOpen className="size-5 shrink-0 text-muted-foreground" />
                  </button>

                  {stats && (
                    <>
                      <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-7 xl:grid-cols-4">
                        <Metric label="unit 数" value={stats.units.length} />
                        <Metric label="run 数" value={stats.runs.length} />
                        <Metric label="CSV 文件" value={stats.files.length} />
                        <Metric
                          label="原始体积"
                          value={Math.round(stats.totalBytes / 1024)}
                        />
                      </div>

                      <div className="mt-6 flex items-center justify-between gap-4 border-t pt-5 text-xs">
                        <span className="text-muted-foreground">
                          已排除 {NUMBER_FORMATTER.format(stats.excludedCount)} 个无关文件
                          （约 {formatBytes(stats.excludedBytes)}）
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setStats(null)}
                        >
                          <X data-icon="inline-start" />
                          清除选择
                        </Button>
                      </div>

                      {stats.units.length > 0 && (
                        <div className="mt-6 border-t border-border pt-5">
                          <p className="text-xs text-muted-foreground">
                            顶层 unit 目录
                          </p>
                          <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
                            {visibleUnits.map((unit) => (
                              <li
                                key={unit}
                                className="truncate border-b border-border/60 py-2"
                              >
                                {unit}
                              </li>
                            ))}
                          </ul>
                          {hiddenUnitCount > 0 && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              + {NUMBER_FORMATTER.format(hiddenUnitCount)} 个更多
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <aside className="flex min-w-0 flex-col justify-between border-t bg-muted p-6 lg:border-l lg:border-t-0">
                  <div>
                    <FolderTree className="size-5 text-muted-foreground" />
                    <h3 className="mt-4 text-base font-medium">合并白名单</h3>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      仅打包以下 3 类 CSV，其余日志（device.log、*.plist、
                      Datalogger、*_flow.log 等）一律丢弃，上传体积可从
                      GB 级降到百 MB 级。
                    </p>
                    <ul className="mt-4 grid gap-2 text-xs">
                      {[
                        'system/time.csv',
                        'system/records.csv',
                        'user/<unit>_pivot.csv',
                      ].map((pattern) => (
                        <li
                          key={pattern}
                          className="break-words rounded-lg border bg-background px-3 py-2"
                        >
                          {pattern}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
                    支持 Chromium 内核浏览器（Chrome / Edge）目录选择。
                  </p>
                </aside>
              </div>
            </section>

            <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="atlas-merge-export-format"
                  className="whitespace-nowrap text-sm text-muted-foreground"
                >
                  导出格式
                </label>
                <Select
                  value={exportFormat}
                  onValueChange={(value) => setExportFormat(value as ExportFormat)}
                >
                  <SelectTrigger
                    id="atlas-merge-export-format"
                    className="w-64"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pivot_to_wide">
                      pivot_to_wide（脚本兼容）
                    </SelectItem>
                    <SelectItem value="insight">
                      insight / Export-ID（标准）
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                onClick={handleAnalyze}
                disabled={!stats || !stats.files.length}
              >
                <BarChart3 data-icon="inline-start" />
                分析
              </Button>
              {error ? (
                <Alert variant="destructive" className="flex-1">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </>
        )}

        {phase === 'analyzing' && stats && (
          <>
            <AnalysisInProgress
              rootName={stats.rootName}
              fileCount={stats.files.length}
              totalBytes={stats.totalBytes}
              upload={archiveUpload}
              step={analyzeStep}
              packReadCount={packReadCount}
              isCompressing={isCompressing}
              jobProgress={jobProgress}
            />
            {pollRetryMessage
              && jobQuery.isError
              && pollFailureCount >= MAX_POLL_FAILURES && (
                <Alert className="mt-6 flex flex-wrap items-center justify-between gap-4">
                  <AlertDescription className="min-w-0 flex-1">
                    连续 {MAX_POLL_FAILURES} 次获取合并进度失败（{pollRetryMessage}
                    ）。任务仍在后台执行：自动轮询已暂停，点「重新查询」重试一次，
                    查询成功后会自动恢复轮询。
                  </AlertDescription>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void jobQuery.refetch().catch(() => undefined)}
                    >
                      <RotateCcw data-icon="inline-start" />
                      重新查询
                    </Button>
                  </div>
                </Alert>
              )}
          </>
        )}

        {phase === 'ready' && analysis && (
          <>
            <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="atlas-result-title">
              <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
                <div className="min-w-0 p-6">
                  <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs text-status-success-foreground">
                        合并完成
                      </p>
                      <h2
                        id="atlas-result-title"
                        className="mt-1 text-lg font-medium tracking-tight"
                      >
                        结果可以复核
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {analysis.unit_count ?? 0} 个 unit ·{' '}
                        {analysis.run_count ?? 0} 行记录 · 数据源{' '}
                        {analysis.data_source ?? '—'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleReset}
                    >
                      <RotateCcw data-icon="inline-start" />
                      重新分析
                    </Button>
                  </div>

                  <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-7 xl:grid-cols-4">
                    <Metric label="unit 数" value={analysis.unit_count ?? 0} />
                    <Metric label="记录行" value={analysis.run_count ?? 0} />
                    <Metric
                      label="测量列"
                      value={analysis.total_measurement_columns ?? 0}
                    />
                  </div>

                  <ParseErrorBanner errors={analysis.parse_errors ?? []} />
                </div>

                <aside className="flex min-w-0 flex-col justify-between border-t bg-muted p-6 lg:border-l lg:border-t-0">
                  <div>
                    <Download className="size-5 text-muted-foreground" />
                    <h3 className="mt-4 text-base font-medium">导出合并结果</h3>
                    <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">
                      {analysis.download_filename}
                    </p>
                    <p
                      className={cn(
                        'mt-3 text-xs',
                        isExpired
                          ? 'text-status-danger-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {analysis.expires_at
                        ? isExpired
                          ? '结果已过期，请重新分析'
                          : `可下载至 ${formatTime(analysis.expires_at)}`
                        : '结果在有效期内可重复下载'}
                    </p>
                  </div>

                  <div className="mt-8 grid gap-3">
                    <Button
                      type="button"
                      onClick={handleDownload}
                      disabled={isDownloading || isExpired}
                    >
                      {isDownloading ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Download data-icon="inline-start" />
                      )}
                      {isDownloading ? '正在下载' : '下载 CSV'}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDeleteResult}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Trash2 data-icon="inline-start" />
                      )}
                      {isBusy ? '正在删除' : '删除结果'}
                    </Button>
                    {downloadError && (
                      <p
                        role="alert"
                        className="mt-1 flex gap-2 text-sm text-status-danger-foreground"
                      >
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        {downloadError}
                      </p>
                    )}
                    {!downloadError && !isExpired && (
                      <p className="mt-1 flex gap-2 text-xs leading-relaxed text-muted-foreground">
                        <CircleCheck className="mt-0.5 size-4 shrink-0 text-status-success-foreground" />
                        结果在有效期内可重复下载。
                      </p>
                    )}
                  </div>
                </aside>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default AtlasMerge;
