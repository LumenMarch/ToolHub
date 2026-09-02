import axios from 'axios';
import {
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Download,
  RotateCcw,
  Search,
} from 'lucide-react';
import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import api from '../../../api/axios';
import { LoadingSignal } from '../../../components/LoadingSignal';
import FileDropZone from '../../../components/FileDropZone';
import { formatTime, parseServerDate } from '../../../lib/format-time';
import {
  type UploadState,
  useTusUpload,
} from '../../../hooks/useTusUpload';

type FileKind = 'attendance' | 'shift';
type Phase = 'upload' | 'analyzing' | 'ready';
type AnalyzeStep = 'uploading' | 'processing';
type ResultTone = 'default' | 'success' | 'danger' | 'warning';
type ResultFilter = 'all' | 'attention' | 'overtime' | 'anomaly';

interface AttendanceSummary {
  total_records: number;
  employee_count: number;
  sheet_count: number;
  leave_event_count: number;
  attention_record_count: number;
  overtime_leave_count: number;
  meal_overtime_count: number;
  capture_time_anomaly_count: number;
  missing_entry_count: number;
}

interface AttendanceResultRow {
  key: string;
  values: string[];
  status_text: string;
  anomaly_text: string;
  flags: string[];
  tone: ResultTone;
  attention: boolean;
}

interface AttendanceResultSheet {
  name: string;
  row_count: number;
  rows: AttendanceResultRow[];
}

interface AttendanceAnalysis {
  result_id: string;
  download_filename: string;
  expires_at: string;
  columns: string[];
  summary: AttendanceSummary;
  sheets: AttendanceResultSheet[];
}


interface AttendanceDataBrowserProps {
  analysis: AttendanceAnalysis;
  isVisible: boolean;
}

const FILTER_OPTIONS: { id: ResultFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'attention', label: '需关注' },
  { id: 'overtime', label: '超时' },
  { id: 'anomaly', label: '数据异常' },
];

const NUMBER_FORMATTER = new Intl.NumberFormat('zh-CN');

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

const formatMegabytes = (bytes: number) =>
  `${(bytes / 1024 / 1024).toFixed(1)} MB`;

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
          已确认 {formatMegabytes(upload.bytesAccepted)} /{' '}
          {formatMegabytes(upload.bytesTotal)}
        </p>
      )}
    </div>
  );
};

const AnalysisInProgress: React.FC<{
  attendanceFile: File;
  shiftFile: File;
  attendanceUpload: UploadProgressState;
  shiftUpload: UploadProgressState;
  step: AnalyzeStep;
}> = ({
  attendanceFile,
  shiftFile,
  attendanceUpload,
  shiftUpload,
  step,
}) => {
  const uploads = [attendanceUpload, shiftUpload];
  const totalBytes = uploads.reduce(
    (total, upload) => total + upload.bytesTotal,
    0,
  );
  const sentBytes = uploads.reduce(
    (total, upload) => total + upload.bytesSent,
    0,
  );
  const acceptedBytes = uploads.reduce(
    (total, upload) => total + upload.bytesAccepted,
    0,
  );
  const totalProgress =
    totalBytes > 0
      ? Math.min(100, Math.floor((sentBytes / totalBytes) * 100))
      : 0;
  const isCompletingUpload =
    step === 'uploading' &&
    totalBytes > 0 &&
    sentBytes >= totalBytes &&
    uploads.some((upload) => upload.status !== 'completed');

  return (
    <section className="flex min-h-96 flex-col justify-start gap-8 rounded-xl border bg-card p-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs text-muted-foreground">
            {step === 'processing'
              ? '分析中'
              : isCompletingUpload
                ? '完成中'
                : '上传中'}
          </p>
          <h2 className="mt-1 text-lg font-medium tracking-tight">
            {step === 'processing'
              ? '正在核对通行记录'
              : isCompletingUpload
                ? '正在完成上传'
                : '正在上传文件'}
          </h2>
        </div>
        <BarChart3 className="size-6 shrink-0 text-muted-foreground" />
      </div>

      <div>
        {step === 'uploading' ? (
          <div className="mb-12 flex flex-col gap-6">
            <UploadProgressRow
              label="通行记录"
              upload={attendanceUpload}
            />
            <UploadProgressRow label="班别明细" upload={shiftUpload} />

            <div className="border-t border-border pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  总体进度
                </span>
                <span className="text-xs tabular-nums">
                  {totalProgress}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${totalProgress}%` }}
                />
              </div>
            </div>

            {isCompletingUpload && (
              <LoadingSignal
                compact
                ariaLabel="文件正在完成上传"
                label="[ 正在完成上传 ]"
                detail={`已确认 ${formatMegabytes(acceptedBytes)} / ${formatMegabytes(totalBytes)}`}
              />
            )}
          </div>
        ) : (
          <LoadingSignal
            ariaLabel="正在分析出勤资料"
            meta="Attendance / Verify"
            label="[ 出勤资料 · 核对中 ]"
            detail="解析通行记录与班别明细"
            className="mb-8"
          />
        )}

        <dl className="grid gap-5 border-t pt-6 text-xs md:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-muted-foreground">
              通行记录
            </dt>
            <dd className="mt-2 break-words text-foreground">
              {attendanceFile.name}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">
              班别明细
            </dt>
            <dd className="mt-2 break-words text-foreground">{shiftFile.name}</dd>
          </div>
        </dl>
      </div>
    </section>
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

const rowToneClass = (tone: ResultTone) => {
  if (tone === 'success') {
    return 'bg-status-success-surface text-status-success-foreground';
  }
  if (tone === 'danger') {
    return 'bg-status-danger-surface text-status-danger-foreground';
  }
  if (tone === 'warning') {
    return 'bg-status-warning-surface text-status-warning-foreground';
  }
  return 'bg-background text-foreground';
};

const rowStatusLabel = (row: AttendanceResultRow) => {
  if (row.anomaly_text) {
    return row.anomaly_text;
  }
  if (row.status_text) {
    return row.status_text;
  }
  return '原始记录';
};

const matchesFilter = (row: AttendanceResultRow, filter: ResultFilter) => {
  if (filter === 'attention') {
    return row.attention;
  }
  if (filter === 'overtime') {
    return row.flags.includes('overtime');
  }
  if (filter === 'anomaly') {
    return (
      row.flags.includes('time_anomaly') ||
      row.flags.includes('missing_entry')
    );
  }
  return true;
};

const useDesktopTable = () => {
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia('(min-width: 48rem)').matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 48rem)');
    const handleChange = () => setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isDesktop;
};

const AttendanceDataBrowser: React.FC<AttendanceDataBrowserProps> = ({
  analysis,
  isVisible,
}) => {
  const isDesktop = useDesktopTable();
  const pageSize = isDesktop ? 50 : 20;
  const [activeSheetName, setActiveSheetName] = useState(
    analysis.sheets[0]?.name ?? '',
  );
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [page, setPage] = useState(1);

  const activeSheet =
    analysis.sheets.find((sheet) => sheet.name === activeSheetName) ??
    analysis.sheets[0];

  const filteredRows = useMemo(() => {
    if (!activeSheet) {
      return [];
    }

    return activeSheet.rows.filter((row) => {
      if (!matchesFilter(row, filter)) {
        return false;
      }
      if (!deferredSearch) {
        return true;
      }
      return [row.values[1], row.values[2], row.values[3], row.values[4]]
        .join(' ')
        .toLowerCase()
        .includes(deferredSearch);
    });
  }, [activeSheet, deferredSearch, filter]);

  useEffect(() => {
    setPage(1);
  }, [activeSheetName, deferredSearch, filter, pageSize]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  return (
    <section
      id="attendance-all-data"
      hidden={!isVisible}
      aria-label="全部分析数据"
      className="mt-6 pt-2"
    >
      <div className="flex flex-col gap-6">
        <div
          className="flex flex-wrap gap-2"
          aria-label="选择工作表"
        >
          {analysis.sheets.map((sheet) => (
            <Button
              key={sheet.name}
              type="button"
              size="sm"
              variant={sheet.name === activeSheet?.name ? 'default' : 'outline'}
              aria-pressed={sheet.name === activeSheet?.name}
              onClick={() => setActiveSheetName(sheet.name)}
            >
              {sheet.name} · {NUMBER_FORMATTER.format(sheet.row_count)}
            </Button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="block min-w-0">
            <span className="text-xs text-muted-foreground">
              搜索员工或部门
            </span>
            <span className="relative mt-2 block">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="工号、姓名、部门代码或名称"
                className="pl-8"
              />
            </span>
          </label>

          <div
            className="flex flex-wrap gap-2"
            aria-label="筛选记录"
          >
            {FILTER_OPTIONS.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={filter === option.id ? 'default' : 'outline'}
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          当前显示 {NUMBER_FORMATTER.format(filteredRows.length)} 条记录
        </p>

        {pageRows.length ? (
          <>
            <div className="hidden max-w-full overflow-x-auto rounded-xl border md:block">
              <table className="min-w-max border-collapse text-left text-xs">
                <caption className="sr-only">
                  {activeSheet?.name}分析结果
                </caption>
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    {analysis.columns.map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className="whitespace-nowrap border-r px-4 py-3 font-medium"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr
                      key={row.key}
                      className={cn(
                        'border-t border-border',
                        rowToneClass(row.tone),
                      )}
                    >
                      {row.values.map((value, columnIndex) => (
                        <td
                          key={`${row.key}-${analysis.columns[columnIndex]}`}
                          className="max-w-80 whitespace-pre-line border-r border-current/10 px-4 py-3 align-top"
                        >
                          {value || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 md:hidden">
              {pageRows.map((row) => (
                <article
                  key={row.key}
                  className={cn(
                    'rounded-xl border p-4',
                    rowToneClass(row.tone),
                  )}
                >
                  <div className="mb-4 flex items-start justify-between gap-4 border-b border-current/15 pb-3">
                    <div className="min-w-0">
                      <p className="break-words text-lg font-bold">
                        {row.values[2] || '未命名员工'}
                      </p>
                      <p className="mt-1 text-xs opacity-70">
                        {row.values[1] || '无工号'}
                      </p>
                    </div>
                    <span className="shrink-0 text-[0.625rem] font-medium">
                      {rowStatusLabel(row)}
                    </span>
                  </div>
                  <dl className="grid gap-3">
                    {analysis.columns.map((column, index) =>
                      row.values[index] ? (
                        <div
                          key={`${row.key}-${column}`}
                          className="grid grid-cols-[minmax(6rem,0.7fr)_minmax(0,1.3fr)] gap-3"
                        >
                          <dt className="text-[0.6875rem] opacity-65">
                            {column}
                          </dt>
                          <dd className="min-w-0 whitespace-pre-line break-words text-sm">
                            {row.values[index]}
                          </dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-xl border px-6 py-16 text-center">
            <Search className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-4 font-medium">没有符合条件的记录</p>
            <p className="mt-2 text-sm text-muted-foreground">
              请调整搜索内容或筛选条件。
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs tabular-nums text-muted-foreground">
            第 {safePage} / {pageCount} 页
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft data-icon="inline-start" />
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount}
              onClick={() =>
                setPage((current) => Math.min(pageCount, current + 1))
              }
            >
              下一页
              <ChevronRight data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

const getExtension = (filename: string) => {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex === -1 ? '' : filename.slice(dotIndex).toLowerCase();
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

const AttendanceOrganizer: React.FC = () => {
  const isAnalyzingRef = useRef(false);
  const [attendanceFile, setAttendanceFile] = useState<File | null>(null);
  const [shiftFile, setShiftFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('upload');
  const [analysis, setAnalysis] = useState<AttendanceAnalysis | null>(null);
  const [error, setError] = useState('');
  const [isDetailsVisible, setIsDetailsVisible] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [isExpired, setIsExpired] = useState(false);

  const [analyzeStep, setAnalyzeStep] = useState<AnalyzeStep>('uploading');

  const attUpload = useTusUpload();
  const shiftUpload = useTusUpload();

  useEffect(() => {
    if (!analysis) {
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

  const handleFileSelect = (kind: FileKind, file: File) => {
    const extension = getExtension(file.name);
    const isValid =
      kind === 'attendance'
        ? extension === '.xls' || extension === '.xlsx'
        : extension === '.xlsx';

    if (!isValid) {
      setError(
        kind === 'attendance'
          ? '通行记录仅支持 .xls 或 .xlsx 格式'
          : '班别文件仅支持 .xlsx 格式',
      );
      return;
    }

    setError('');
    if (kind === 'attendance') {
      setAttendanceFile(file);
    } else {
      setShiftFile(file);
    }
  };

  const handleAnalyze = async () => {
    if (isAnalyzingRef.current) {
      return;
    }
    if (!attendanceFile || !shiftFile) {
      setError('请先选择通行记录和班别文件');
      return;
    }

    setError('');
    setAnalysis(null);
    setIsDetailsVisible(false);
    setPhase('analyzing');
    setAnalyzeStep('uploading');
    isAnalyzingRef.current = true;

    try {
      // 并行上传两个文件，各自追踪进度
      const [attId, shiftId] = await Promise.all([
        attUpload.upload({ file: attendanceFile, metadata: { filename: attendanceFile.name } }),
        shiftUpload.upload({ file: shiftFile, metadata: { filename: shiftFile.name } }),
      ]);

      setAnalyzeStep('processing');

      const response = await api.post<AttendanceAnalysis>(
        '/tools/attendance/analyze',
        {
          attendance_upload_id: attId,
          shift_upload_id: shiftId,
        },
      );
      setAnalysis(response.data);
      setPhase('ready');
    } catch (requestError) {
      setError(await readErrorMessage(requestError));
      setPhase('upload');
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
        `/tools/attendance/results/${analysis.result_id}/download`,
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
      if (axios.isAxiosError(requestError) && requestError.response?.status === 410) {
        setIsExpired(true);
      }
      setDownloadError(await readErrorMessage(requestError));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleReset = () => {
    if (analysis) {
      void api
        .delete(`/tools/attendance/results/${analysis.result_id}`)
        .catch(() => undefined);
    }
    setAnalysis(null);
    setError('');
    setDownloadError('');
    setIsDetailsVisible(false);
    setPhase('upload');
  };

  return (
    <div className="flex w-full flex-col">
      <div>
        {phase === 'upload' && (
          <>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <FileDropZone
                id="attendance-file"
                label="01 / 通行记录"
                description="支持 .xls 或 .xlsx，包含一个或多个人员工作表。"
                accept=".xls,.xlsx"
                file={attendanceFile}
                onSelect={(file) => handleFileSelect('attendance', file)}
              />
              <FileDropZone
                id="shift-file"
                label="02 / 班别明细"
                description="仅支持 .xlsx，必须覆盖通行记录中的全部员工。"
                accept=".xlsx"
                file={shiftFile}
                onSelect={(file) => handleFileSelect('shift', file)}
              />
            </div>

            <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center">
              <Button
                type="button"
                onClick={handleAnalyze}
                disabled={!attendanceFile || !shiftFile}
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

        {phase === 'analyzing' && attendanceFile && shiftFile && (
          <AnalysisInProgress
            attendanceFile={attendanceFile}
            shiftFile={shiftFile}
            attendanceUpload={attUpload}
            shiftUpload={shiftUpload}
            step={analyzeStep}
          />
        )}

        {phase === 'ready' && analysis && (
          <>
            <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="attendance-result-title">
              <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
                <div className="min-w-0 p-6">
                  <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs text-status-success-foreground">
                        分析完成
                      </p>
                      <h2
                        id="attendance-result-title"
                        className="mt-1 text-lg font-medium tracking-tight"
                      >
                        结果可以复核
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {analysis.summary.sheet_count} 个工作表 · 结果按原顺序整理
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
                    <Metric
                      label="记录"
                      value={analysis.summary.total_records}
                    />
                    <Metric
                      label="员工"
                      value={analysis.summary.employee_count}
                    />
                    <Metric
                      label="离岗事件"
                      value={analysis.summary.leave_event_count}
                    />
                    <Metric
                      label="需关注"
                      value={analysis.summary.attention_record_count}
                    />
                  </div>

                  <dl className="mt-8 grid gap-x-8 gap-y-3 border-t border-border pt-6 text-sm sm:grid-cols-2">
                    {[
                      ['普通超时', analysis.summary.overtime_leave_count],
                      ['用餐超时', analysis.summary.meal_overtime_count],
                      ['抓拍时间异常', analysis.summary.capture_time_anomaly_count],
                      ['缺少进入时间', analysis.summary.missing_entry_count],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-4"
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-medium tabular-nums">
                          {NUMBER_FORMATTER.format(Number(value))}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <Button
                    type="button"
                    variant="outline"
                    className="mt-6"
                    aria-expanded={isDetailsVisible}
                    aria-controls="attendance-all-data"
                    onClick={() => setIsDetailsVisible((current) => !current)}
                  >
                    {isDetailsVisible ? '收起全部数据' : '查看全部数据'}
                    <span className="text-xs opacity-70">
                      {NUMBER_FORMATTER.format(analysis.summary.total_records)}
                    </span>
                  </Button>
                </div>

                <aside className="flex min-w-0 flex-col justify-between border-t bg-muted p-6 lg:border-l lg:border-t-0">
                  <div>
                    <Download className="size-5 text-muted-foreground" />
                    <h3 className="mt-4 text-base font-medium">导出完整工作簿</h3>
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
                      {isExpired
                        ? '结果已过期，请重新分析'
                        : `可下载至 ${formatTime(analysis.expires_at)}`}
                    </p>
                  </div>

                  <div className="mt-8">
                    <Button
                      type="button"
                      className="w-full"
                      onClick={handleDownload}
                      disabled={isDownloading || isExpired}
                    >
                      {isDownloading ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Download data-icon="inline-start" />
                      )}
                      {isDownloading ? '正在下载' : '下载 Excel'}
                    </Button>
                    {downloadError ? (
                      <p
                        role="alert"
                        className="mt-4 flex gap-2 text-sm text-status-danger-foreground"
                      >
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        {downloadError}
                      </p>
                    ) : null}
                    {!downloadError && !isExpired ? (
                      <p className="mt-4 flex gap-2 text-xs leading-relaxed text-muted-foreground">
                        <CircleCheck
                          className="mt-0.5 size-4 shrink-0 text-status-success-foreground"
                        />
                        结果在有效期内可重复下载。
                      </p>
                    ) : null}
                  </div>
                </aside>
              </div>
            </section>

            <AttendanceDataBrowser
              analysis={analysis}
              isVisible={isDetailsVisible}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default AttendanceOrganizer;
