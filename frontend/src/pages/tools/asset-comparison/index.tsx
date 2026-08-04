/*
 * Hallmark · genre: modern-minimal · macrostructure: Workbench
 * design-system: DESIGN.md · designed-as-app
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 */
import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  CheckCircle,
  CheckSquareOffset,
  CircleNotch,
  Database,
  DownloadSimple,
  FileArrowUp,
  FileXls,
  FloppyDisk,
  FolderOpen,
  MagnifyingGlass,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import api from '../../../api/axios';
import { LoadingSignal } from '../../../components/LoadingSignal';
import { useTusUpload } from '../../../hooks/useTusUpload';
import type {
  AssetComparisonInputs,
  DifferenceType,
} from './types';
import { useAssetDifferenceDetails } from './useAssetDifferenceDetails';
import { useAssetComparisonJob } from './useAssetComparisonJob';

const UnboxedFileInput: React.FC<{
  label: string;
  value: string;
  onChange: (val: string) => void;
  displayValue?: string;
  disabled?: boolean;
}> = ({ label, value, onChange, displayValue, disabled = false }) => {
  const shown = displayValue ?? (value.includes('/') ? value.split('/').pop()! : value.includes('\\') ? value.split('\\').pop()! : value);

  return (
    <label className="group block min-w-0 border-b border-border py-3 focus-within:border-primary">
      <span className="mb-1 block font-mono text-xs text-muted-foreground transition-colors group-focus-within:text-primary">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <input
          type="text"
          value={shown}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="min-w-0 flex-1 truncate border-none bg-transparent p-0 text-base font-medium tracking-wide text-foreground outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm"
          placeholder="尚未匹配"
        />
        <FileArrowUp weight="bold" className="size-4 shrink-0 text-muted-foreground transition-colors group-focus-within:text-primary" />
      </span>
    </label>
  );
};

interface ModuleProgress {
  loaded: number;
  accepted: number;
  total: number;
  fileCount: number;
  okCount: number;
  failCount: number;
}

type ModuleKey = 'finance' | 'sfc' | 'notes' | 'customer';
type InputKey = keyof AssetComparisonInputs;

const REVIEW_OPTIONS = ['差異確認OK', '待跟进', '異常'];
const SOURCE_GROUPS: Array<{
  key: ModuleKey;
  label: string;
  fields: Array<{ key: InputKey; label: string }>;
}> = [
  {
    key: 'finance',
    label: '财务',
    fields: [
      { key: 'thisFinance', label: '本期数据' },
      { key: 'lastFinance', label: '上期数据' },
    ],
  },
  {
    key: 'sfc',
    label: 'SFC',
    fields: [
      { key: 'thisSFC', label: '本期数据' },
      { key: 'lastSFC', label: '上期数据' },
    ],
  },
  {
    key: 'notes',
    label: 'Notes',
    fields: [
      { key: 'thisNotes', label: '本期数据' },
      { key: 'lastNotes', label: '上期数据' },
    ],
  },
  {
    key: 'customer',
    label: '客户',
    fields: [
      { key: 'thisCustomer', label: '本期数据' },
      { key: 'lastCustomer', label: '上期数据' },
    ],
  },
];
const CONFIG_FIELDS: Array<{ key: InputKey; label: string }> = [
  { key: 'departmentData', label: '保管部门配置' },
  { key: 'custodianData', label: '保管人配置' },
  { key: 'driData', label: '客户 DRI 配置' },
];
const RESULT_SOURCES: Record<string, Array<{ key: InputKey; label: string }>> = {
  ff: [
    { key: 'thisFinance', label: '本期财务' },
    { key: 'lastFinance', label: '上期财务' },
  ],
  nn: [
    { key: 'thisNotes', label: '本期 Notes' },
    { key: 'lastNotes', label: '上期 Notes' },
  ],
  sfc: [
    { key: 'thisSFC', label: '本期 SFC' },
    { key: 'lastSFC', label: '上期 SFC' },
  ],
  cc: [
    { key: 'thisCustomer', label: '本期客户' },
    { key: 'lastCustomer', label: '上期客户' },
  ],
  fn: [
    { key: 'thisFinance', label: '本期财务' },
    { key: 'thisNotes', label: '本期 Notes' },
  ],
  ns: [
    { key: 'thisNotes', label: '本期 Notes' },
    { key: 'thisSFC', label: '本期 SFC' },
  ],
  cn: [
    { key: 'thisCustomer', label: '本期客户' },
    { key: 'thisNotes', label: '本期 Notes' },
  ],
};
const EMPTY_INPUTS: AssetComparisonInputs = {
  thisFinance: '',
  lastFinance: '',
  thisSFC: '',
  lastSFC: '',
  thisNotes: '',
  lastNotes: '',
  thisCustomer: '',
  lastCustomer: '',
  departmentData: '',
  custodianData: '',
  driData: '',
};

// 核心数据结构推导的常量（避免魔法数字）
const TOTAL_INPUT_COUNT = Object.keys(EMPTY_INPUTS).length;
const TOTAL_MODULE_COUNT = Object.keys(RESULT_SOURCES).length;
function createEmptyModuleProgress(): Record<ModuleKey, ModuleProgress> {
  return {
    finance: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
    sfc: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
    notes: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
    customer: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
  };
}

function getFileName(value: string): string {
  if (!value) return '尚未匹配';
  return value.split(/[\\/]/).pop() || value;
}

function formatTaskMonth(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '当前周期';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(date);
}

function formatTimestamp(value?: string | null): string {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatBytes(value?: number): string {
  if (!value) return '—';
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/** 提取错误消息，兼容 axios error / string / unknown */
function getErrorMessage(err: unknown): string {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const detail = typeof e.response === 'object' && e.response !== null
      ? (e.response as Record<string, unknown>)?.data as Record<string, unknown> | undefined
      : undefined;
    if (detail && typeof detail.detail === 'string') return detail.detail;
    if (detail && typeof detail.message === 'string') return detail.message;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

/** 是否为 ModuleKey */
function isModuleKey(s: string): s is ModuleKey {
  return s === 'finance' || s === 'sfc' || s === 'notes' || s === 'customer';
}

/** 根据文件名关键词分类到模块 */
function classifyFile(name: string): ModuleKey | 'config' | 'other' {
  const n = name.replace(/[\s_\-（）()]/g, '');
  if (n.includes('保管人') || n.includes('保管部门') || n.includes('DRI') || n.includes('dri')) return 'config';
  if (n.includes('财务')) return 'finance';
  if (n.includes('SFC') || n.includes('sfc')) return 'sfc';
  if (n.includes('Notes') || n.includes('notes')) return 'notes';
  if (n.includes('客户') || n.includes('Customer') || n.includes('customer')) return 'customer';
  return 'other';
}

const Badge: React.FC<{ variant: 'ok' | 'warn' | 'err' | 'info'; children: React.ReactNode }> = ({ variant, children }) => {
  const colors: Record<string, string> = {
    ok: 'border-status-success-foreground/40 text-status-success-foreground bg-status-success-surface',
    warn: 'border-status-warning-foreground/40 text-status-warning-foreground bg-status-warning-surface',
    err: 'border-status-danger-foreground/40 text-status-danger-foreground bg-status-danger-surface',
    info: 'border-primary/40 text-primary bg-primary/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[0.65rem] font-bold uppercase tracking-wider ${colors[variant]}`}>
      {children}
    </span>
  );
};

const ModuleProgressBar: React.FC<{ label: string; progress: ModuleProgress }> = ({ label, progress }) => {
  if (progress.fileCount === 0 && progress.total === 0) return null;
  const sentPct = progress.total > 0 ? Math.min((progress.loaded / progress.total) * 100, 100) : 0;
  const acceptedPct = progress.total > 0 ? Math.min((progress.accepted / progress.total) * 100, 100) : 0;
  const done = progress.okCount + progress.failCount >= progress.fileCount;
  const color = done ? (progress.failCount > 0 ? 'bg-status-warning-foreground' : 'bg-status-success-foreground') : 'bg-primary';
  const isConfirming = !done && sentPct >= 100 && acceptedPct < 100;
  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <div className="flex items-center justify-between text-xs font-mono mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">
          {progress.okCount}/{progress.fileCount}
          {progress.failCount > 0 && <span className="text-status-warning-foreground ml-1">({progress.failCount}失败)</span>}
        </span>
      </div>
      <div className="relative h-1.5 bg-border/50 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/30"
          style={{ width: `${sentPct}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${color}`}
          style={{ width: `${done ? 100 : acceptedPct}%` }}
        />
      </div>
      {isConfirming ? (
        <LoadingSignal
          compact
          className="mt-3"
          ariaLabel={`${label}正在完成上传`}
          label="[ 正在完成上传 ]"
          detail={`已确认 ${(progress.accepted / 1024 / 1024).toFixed(1)} / ${(progress.total / 1024 / 1024).toFixed(1)} MB`}
        />
      ) : progress.accepted > 0 && !done ? (
        <p className="mt-2 text-xs tabular-nums text-muted-foreground">
          已确认 {(progress.accepted / 1024 / 1024).toFixed(1)} / {(progress.total / 1024 / 1024).toFixed(1)} MB
        </p>
      ) : null}
    </div>
  );
};

const AssetComparison: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const [paths, setPaths] = useState<AssetComparisonInputs>(EMPTY_INPUTS);

  const [folderPath, setFolderPath] = useState('');
  const selectedFilesRef = useRef<File[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<React.ReactNode>('');
  const [isScanning, setIsScanning] = useState(false);
  const scanInFlightRef = useRef(false);
  const [isResettingPage, setIsResettingPage] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(true);
  const [activeResultKey, setActiveResultKey] = useState('');
  const [differenceType, setDifferenceType] = useState<DifferenceType>('all');
  const [differenceQuery, setDifferenceQuery] = useState('');
  const [differencePage, setDifferencePage] = useState(0);
  const restoredJobRef = useRef('');
  const {
    job,
    error: jobError,
    expiredJobId,
    isStarting,
    isFinalizing,
    isCancelling,
    retryingArtifact,
    annotationSaveStatus,
    start,
    saveAnnotations,
    finalize,
    retry,
    cancel,
    reset,
    download,
  } = useAssetComparisonJob();
  const checkResults = job?.results ?? [];
  const isJobActive = job
    ? ['queued', 'validating', 'running', 'finalizing', 'cancel_requested'].includes(job.status)
    : false;
  const isInputLocked = isJobActive || isResettingPage;

  const [moduleProgress, setModuleProgress] = useState<
    Record<ModuleKey, ModuleProgress>
  >(createEmptyModuleProgress);

  const { upload } = useTusUpload();

  const handlePathChange = (key: keyof typeof paths, value: string) => {
    if (isInputLocked) return;
    setPaths(prev => ({ ...prev, [key]: value }));
  };

  const handleRemarkChange = (key: string, value: string) => {
    setRemarks(prev => ({ ...prev, [key]: value }));
  };

  const handleReviewChange = (key: string, value: string) => {
    const nextReviews = { ...reviews, [key]: value };
    setReviews(nextReviews);
    if (job) {
      void saveAnnotations(remarks, nextReviews).catch(() => undefined);
    }
  };

  const handleActiveResultChange = (key: string) => {
    setActiveResultKey(key);
    setDifferenceType('all');
    setDifferenceQuery('');
    setDifferencePage(0);
  };

  useEffect(() => {
    if (!job || restoredJobRef.current === job.jobId) return;
    restoredJobRef.current = job.jobId;
    setPaths(job.inputs);
    setRemarks(job.remarks);
    setReviews(job.reviews);
    setIsSourcesOpen(false);
  }, [job]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.from('.gsap-reveal', {
        y: 16,
        opacity: 0,
        duration: 0.65,
        stagger: 0.08,
        ease: 'expo.out',
        delay: 0.12
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const handleSelectFolder = () => {
    folderInputRef.current?.click();
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    selectedFilesRef.current = Array.from(files);
    const firstPath = files[0].webkitRelativePath;
    const folderName = firstPath.split('/')[0];
    setFolderPath(folderName);

    const counts: Record<string, number> = {};
    for (const f of Array.from(files)) {
      const mod = classifyFile(f.name);
      counts[mod] = (counts[mod] || 0) + 1;
    }
    const summary = Object.entries(counts)
      .filter(([k]) => k !== 'other' && k !== 'config')
      .map(([k, v]) => `${k}(${v}个)`)
      .join('、');

    setStatusMsg(
      <div className="text-xs leading-relaxed">
        <Badge variant="info">已选择</Badge> 文件夹 <span className="font-bold">{folderName}</span>，共 {files.length} 个文件
        {summary ? `（${summary}）` : ''}。点击「扫描解析」上传并匹配。
      </div>
    );
    e.target.value = '';
  };

  const handleScanFolder = async () => {
    if (
      scanInFlightRef.current
      || isScanning
      || isJobActive
      || isResettingPage
    ) return;
    scanInFlightRef.current = true;
    const fileArr = selectedFilesRef.current;

    if (fileArr.length > 0) {
      setIsScanning(true);
      const initProgress = createEmptyModuleProgress();

      for (const f of fileArr) {
        const mod = classifyFile(f.name);
        if (isModuleKey(mod)) {
          initProgress[mod].fileCount++;
          initProgress[mod].total += f.size;
        }
      }
      setModuleProgress(initProgress);

      try {
        const uploadIds: string[] = [];
        const failMsgs: string[] = [];

        setStatusMsg(<span>正在上传文件（并发模式）...</span>);

        const uploadTasks = fileArr.map((f) => {
          const mod = classifyFile(f.name);
          let sentForFile = 0;
          let acceptedForFile = 0;

          const updateModuleBytes = (sentDelta: number, acceptedDelta: number) => {
            if (!isModuleKey(mod)) {
              return;
            }
            setModuleProgress(prev => {
              const cur = { ...prev[mod] };
              cur.loaded = Math.min(cur.loaded + sentDelta, cur.total);
              cur.accepted = Math.min(cur.accepted + acceptedDelta, cur.total);
              return { ...prev, [mod]: cur };
            });
          };

          return upload({
            file: f,
            metadata: { filename: f.name },
            onProgress: (bytesSent) => {
              const sentDelta = Math.max(0, bytesSent - sentForFile);
              sentForFile = bytesSent;
              updateModuleBytes(sentDelta, 0);
            },
            onChunkComplete: (_chunkSize, bytesAccepted) => {
              const acceptedDelta = Math.max(0, bytesAccepted - acceptedForFile);
              acceptedForFile = bytesAccepted;
              updateModuleBytes(0, acceptedDelta);
            },
          })
            .then((uploadId) => {
              uploadIds.push(uploadId);
              updateModuleBytes(
                Math.max(0, f.size - sentForFile),
                Math.max(0, f.size - acceptedForFile),
              );
              if (isModuleKey(mod)) {
                setModuleProgress(prev => {
                  const cur = { ...prev[mod] };
                  cur.okCount++;
                  return { ...prev, [mod]: cur };
                });
              }
            })
            .catch((upErr: unknown) => {
              const msg = getErrorMessage(upErr);
              failMsgs.push(`${f.name}: ${msg}`);
              updateModuleBytes(Math.max(0, f.size - sentForFile), 0);
              if (isModuleKey(mod)) {
                setModuleProgress(prev => {
                  const cur = { ...prev[mod] };
                  cur.failCount++;
                  return { ...prev, [mod]: cur };
                });
              }
            });
        });

        await Promise.all(uploadTasks);

        const okCount = uploadIds.length;
        const failCount = failMsgs.length;

        if (okCount === 0) {
          setStatusMsg(
            <span>
              <Badge variant="err">失败</Badge> 全部 {fileArr.length} 个文件上传失败：{failMsgs.join('；')}
            </span>
          );
          return;
        }
        setStatusMsg(
          <span>已上传 {okCount}/{fileArr.length} 个文件，正在匹配...</span>
        );
        const scanRes = await api.post('/tools/asset/scan', { upload_ids: uploadIds });

        if (scanRes.data.status === 'success') {
          const data = scanRes.data.data;
          const filledCount = Object.values(data).filter((v) => v !== '').length;
          const totalCount = Object.keys(data).length;
          setPaths(data);
          if (filledCount > 0) {
            setStatusMsg(
              <span>
                <Badge variant="ok">完成</Badge> 已匹配 {filledCount}/{totalCount} 个数据表
                {failCount > 0 ? `（上传 ${okCount}/${fileArr.length}）` : ''}，请确认后点击「开始核对」。
              </span>
            );
          } else {
            setStatusMsg(
              <span>
                <Badge variant="warn">警告</Badge> 未匹配到任何数据表，请确认文件名包含正确关键词和年月。
              </span>
            );
          }
        } else {
          setStatusMsg(<span><Badge variant="err">失败</Badge> {scanRes.data.message}</span>);
        }

        if (failMsgs.length > 0 && okCount > 0) {
          setStatusMsg(prev => (
            <div className="flex flex-col gap-1">
              {prev}
              <span className="flex items-center gap-1 text-xs text-status-warning-foreground">
                <Warning className="size-3.5" weight="bold" />
                {failMsgs.length} 个文件上传失败
              </span>
            </div>
          ));
        }
      } catch (err: unknown) {
        setStatusMsg(<span><Badge variant="err">错误</Badge> {getErrorMessage(err)}</span>);
      } finally {
        setIsScanning(false);
        scanInFlightRef.current = false;
        selectedFilesRef.current = [];
      }
      return;
    }

    if (!folderPath.trim()) {
      setStatusMsg(<span><Badge variant="warn">提示</Badge> 请先选择文件夹或输入服务器上的文件夹路径</span>);
      scanInFlightRef.current = false;
      return;
    }
    setIsScanning(true);
    setStatusMsg(<span>正在解析文件夹: {folderPath} ...</span>);
    try {
      const res = await api.get('/tools/asset/auto-paths', {
        params: { folder: folderPath.trim() }
      });
      if (res.data.status === 'success') {
        const data = res.data.data;
        const filledCount = Object.values(data).filter((v) => v !== '').length;
        const totalCount = Object.keys(data).length;
        setPaths(data);
        if (filledCount > 0) {
          setStatusMsg(
            <span>
              <Badge variant="ok">完成</Badge> 已匹配 {filledCount}/{totalCount} 个数据表，请确认后点击「开始核对」。
            </span>
          );
        } else {
          setStatusMsg(
            <span>
              <Badge variant="warn">警告</Badge> 未匹配到任何数据表，请确认文件名包含正确关键词和年月。
            </span>
          );
        }
      } else {
        setStatusMsg(<span><Badge variant="err">失败</Badge> {res.data.message}</span>);
      }
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">错误</Badge> 请求: {getErrorMessage(err)}</span>);
    } finally {
      setIsScanning(false);
      scanInFlightRef.current = false;
    }
  };

  const handleCheck = async () => {
    if (isStarting || isJobActive || isResettingPage) return;
    const hasMissingPath = Object.values(paths).some(value => !value.trim());
    if (hasMissingPath) {
      setStatusMsg(
        <span><Badge variant="warn">提示</Badge> 请先补齐全部输入文件</span>,
      );
      return;
    }

    setStatusMsg('正在创建核对任务...');
    setRemarks({});
    setReviews({});
    try {
      await start(paths);
      setStatusMsg('');
      setIsSourcesOpen(false);
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">错误</Badge> 请求: {getErrorMessage(err)}</span>);
    }
  };

  const handleSaveAll = async () => {
    if (!job || isFinalizing) return;
    const currentFinalArtifact = job.artifacts.final_bundle;
    if (
      currentFinalArtifact?.status === 'ready'
      && job.finalizedRevision === job.annotationRevision
      && !annotationsDirty
      && !inputsChanged
    ) {
      download('final_bundle');
      return;
    }

    const missingRemarks = checkResults.filter(r => r.has_diff && !remarks[r.key]?.trim());
    if (missingRemarks.length > 0) {
      alert(`请先填写以下有差异模块的异常原因：\n${missingRemarks.map(r => r.label.replace(/【|】/g, '')).join(', ')}`);
      return;
    }

    setStatusMsg('正在保存异常原因并生成对比总结与 PDF...');
    try {
      const nextJob = annotationsDirty
        ? await saveAnnotations(remarks, reviews)
        : job;
      if (!nextJob?.canFinalize) {
        setStatusMsg(
          <span>
            <Badge variant="warn">等待</Badge>{' '}
            {nextJob?.finalizeBlockers[0]?.message ?? '任务状态正在更新，请稍后重试'}
          </span>,
        );
        return;
      }
      await finalize();
      setStatusMsg('');
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">失败</Badge> {getErrorMessage(err)}</span>);
    }
  };

  const handleExportSingle = async (key: string) => {
    const artifactKey = `module_${key}`;
    if (retryingArtifact === artifactKey) return;
    const artifact = job?.artifacts[artifactKey];
    if (!artifact) return;
    if (artifact.status === 'ready') {
      download(artifactKey);
      return;
    }
    if (artifact.status !== 'failed') return;

    try {
      await retry(artifactKey);
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">失败</Badge> {getErrorMessage(err)}</span>);
    }
  };

  const handleRemarkBlur = () => {
    if (job) {
      void saveAnnotations(remarks, reviews).catch(() => undefined);
    }
  };

  const handleCancelJob = async () => {
    if (!job || !isJobActive || isCancelling) return;
    try {
      await cancel();
      setStatusMsg('已提交取消请求，正在停止后台任务...');
    } catch (err: unknown) {
      setStatusMsg(
        <span><Badge variant="err">失败</Badge> {getErrorMessage(err)}</span>,
      );
    }
  };

  const resetDisabled = Boolean(
    isScanning
    || isStarting
    || isJobActive
    || isFinalizing
    || isResettingPage
    || retryingArtifact,
  );
  const hasResettableState = Boolean(
    job
    || folderPath.trim()
    || Object.values(paths).some(value => value.trim())
    || statusMsg
    || Object.keys(remarks).length
    || Object.keys(reviews).length
    || Object.values(moduleProgress).some(progress => progress.fileCount > 0),
  );

  const handleResetPage = async () => {
    if (resetDisabled || !hasResettableState) return;
    const confirmed = window.confirm(
      '将清空当前页面，并永久删除对应的后台任务和已生成文件。此操作不可恢复，确定继续吗？',
    );
    if (!confirmed) return;

    setIsResettingPage(true);
    try {
      await reset();
      setPaths(EMPTY_INPUTS);
      setFolderPath('');
      selectedFilesRef.current = [];
      if (folderInputRef.current) {
        folderInputRef.current.value = '';
      }
      setRemarks({});
      setReviews({});
      setStatusMsg('');
      setModuleProgress(createEmptyModuleProgress());
      setIsSourcesOpen(true);
      setActiveResultKey('');
      restoredJobRef.current = '';
    } catch (err: unknown) {
      setStatusMsg(
        <span>
          <Badge variant="err">失败</Badge> 无法删除后台任务：{getErrorMessage(err)}
        </span>,
      );
    } finally {
      setIsResettingPage(false);
    }
  };

  const finalArtifact = job?.artifacts.final_bundle;
  const hasGeneratedFinal = Boolean(
    (
      job?.finalizedRevision !== null
      && job?.finalizedRevision !== undefined
    )
    || ['ready', 'stale'].includes(finalArtifact?.status ?? ''),
  );
  const inputsChanged = Boolean(
    job && JSON.stringify(paths) !== JSON.stringify(job.inputs),
  );
  const localMissingRemarks = checkResults.filter(
    result => result.has_diff && !remarks[result.key]?.trim(),
  );
  const normalizedLocalReviews = Object.fromEntries(
    checkResults.map(result => [
      result.key,
      reviews[result.key] || REVIEW_OPTIONS[0],
    ]),
  );
  const normalizedJobReviews = Object.fromEntries(
    checkResults.map(result => [
      result.key,
      job?.reviews[result.key] || REVIEW_OPTIONS[0],
    ]),
  );
  const annotationsDirty = Boolean(
    job
    && (
      JSON.stringify(remarks) !== JSON.stringify(job.remarks)
      || JSON.stringify(normalizedLocalReviews) !== JSON.stringify(normalizedJobReviews)
    ),
  );
  const serverBlockersAfterDraft = (
    job?.finalizeBlockers.filter(blocker => (
      blocker.code !== 'missing_remarks' || localMissingRemarks.length > 0
    )) ?? []
  );
  const finalButtonIsDownload = Boolean(
    finalArtifact?.status === 'ready'
    && job?.finalizedRevision === job?.annotationRevision
    && !annotationsDirty
    && !inputsChanged
  );
  const finalIsBuilding = Boolean(
    isFinalizing
    || retryingArtifact === 'final_bundle'
    || finalArtifact?.status === 'building',
  );
  const finalButtonDisabled = Boolean(
    !job
    || finalIsBuilding
    || (!finalButtonIsDownload && inputsChanged)
    || (
      !finalButtonIsDownload
      && (
        localMissingRemarks.length > 0
        || serverBlockersAfterDraft.length > 0
      )
    ),
  );
  const finalButtonLabel = (() => {
    if (!job) return '等待核对';
    if (finalIsBuilding) return '正在生成对比总结与 PDF';
    if (finalButtonIsDownload) return '下载完整结果';
    if (inputsChanged) return '输入已更改，请重新核对';
    if (localMissingRemarks.length > 0) {
      return `请填写 ${localMissingRemarks.length} 项异常原因`;
    }
    if (annotationSaveStatus === 'saving') return '正在保存异常原因';
    if (finalArtifact?.status === 'failed') return '生成失败，点击重试';
    if (
      hasGeneratedFinal
      && (annotationsDirty || finalArtifact?.status === 'stale')
    ) {
      return '内容已更新，重新生成总结与 PDF';
    }
    const comparisonProgress = job.progress.comparison;
    if (
      comparisonProgress
      && comparisonProgress.completed < comparisonProgress.total
    ) {
      return `等待资产核对 ${comparisonProgress.completed}/${comparisonProgress.total}`;
    }
    const artifactProgress = job.progress.moduleArtifacts;
    if (
      artifactProgress
      && artifactProgress.completed < artifactProgress.total
    ) {
      return `等待模块文件 ${artifactProgress.completed}/${artifactProgress.total}`;
    }
    return serverBlockersAfterDraft[0]?.message ?? '生成对比总结与 PDF';
  })();
  const annotationStatusLabel = (() => {
    if (annotationSaveStatus === 'saving') return '异常原因保存中';
    if (annotationSaveStatus === 'error') return '异常原因保存失败，草稿已保留';
    if (annotationsDirty) return '异常原因尚未保存';
    if (annotationSaveStatus === 'saved') return '异常原因已保存';
    return '';
  })();
  const matchedPathCount = Object.values(paths).filter(value => value.trim()).length;
  const comparisonCompleted = job?.progress.comparison?.completed ?? 0;
  const comparisonTotal = job?.progress.comparison?.total ?? (checkResults.length || TOTAL_MODULE_COUNT);
  const attentionCount = checkResults.filter(
    result => result.status === 'ready' && result.has_diff,
  ).length;
  const activeResult = (
    checkResults.find(result => result.key === activeResultKey)
    ?? checkResults.find(result => result.has_diff)
    ?? checkResults[0]
  );
  const activeSources = activeResult ? (RESULT_SOURCES[activeResult.key] ?? []) : [];
  const activeArtifactKey = activeResult ? `module_${activeResult.key}` : '';
  const activeArtifact = activeArtifactKey ? job?.artifacts[activeArtifactKey] : undefined;
  const activeArtifactBusy = ['blocked', 'pending', 'building'].includes(
    activeArtifact?.status ?? 'blocked',
  );
  const activeResultIndex = activeResult
    ? checkResults.findIndex(result => result.key === activeResult.key)
    : -1;
  const reviewedCount = checkResults.filter(
    result => result.status === 'ready' && Boolean(reviews[result.key]),
  ).length;
  const rawArtifact = job?.artifacts.raw_data_xlsx;
  const detailEnabled = Boolean(
    job
    && activeResult?.status === 'ready'
    && !isJobActive,
  );
  const {
    data: differenceData,
    error: differenceError,
    isLoading: isDifferenceLoading,
    pageSize: differencePageSize,
  } = useAssetDifferenceDetails({
    jobId: job?.jobId,
    moduleKey: activeResult?.key,
    type: differenceType,
    query: differenceQuery,
    page: differencePage,
    enabled: detailEnabled,
  });
  const activeCounts = differenceData?.totals ?? {
    all: (
      (activeResult?.counts?.new ?? 0)
      + (activeResult?.counts?.removed ?? 0)
      + (activeResult?.counts?.anomaly ?? 0)
    ),
    new: activeResult?.counts?.new ?? 0,
    removed: activeResult?.counts?.removed ?? 0,
    anomaly: activeResult?.counts?.anomaly ?? 0,
  };
  const differencePageCount = Math.max(
    1,
    Math.ceil((differenceData?.filteredTotal ?? 0) / differencePageSize),
  );

  const moveActiveResult = (direction: -1 | 1) => {
    if (activeResultIndex < 0 || checkResults.length === 0) return;
    const nextIndex = Math.min(
      Math.max(activeResultIndex + direction, 0),
      checkResults.length - 1,
    );
    handleActiveResultChange(checkResults[nextIndex].key);
  };

  const handleSaveAndNext = async () => {
    if (!job || !activeResult) return;
    const nextReviews = reviews[activeResult.key]
      ? reviews
      : { ...reviews, [activeResult.key]: REVIEW_OPTIONS[0] };
    setReviews(nextReviews);
    try {
      await saveAnnotations(remarks, nextReviews);
      if (activeResultIndex < checkResults.length - 1) {
        moveActiveResult(1);
      }
    } catch {
      // 保存错误由任务 Hook 统一展示，当前模块保持不变。
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto"
    >
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory 是非标准属性
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={handleFolderChange}
      />

      <section className="gsap-reveal border-y border-border">
        <div className="grid grid-cols-2 divide-x divide-y divide-border min-[60rem]:grid-cols-[minmax(18rem,1.5fr)_repeat(3,minmax(7rem,0.5fr))] min-[60rem]:divide-y-0">
          <div className="col-span-2 min-w-0 px-4 py-4 min-[60rem]:col-span-1">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-bold tracking-tight">
                  {formatTaskMonth(job?.createdAt)}资产核对
                </h1>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {job ? `TASK ${job.jobId.slice(0, 8).toUpperCase()}` : '尚未创建任务'}
                  <span className="mx-2 text-border">/</span>
                  {isJobActive ? '后台核对进行中' : job ? '等待审阅与归档' : '等待输入数据'}
                </p>
              </div>
              <span className={`mt-1 size-2 shrink-0 ${isJobActive ? 'bg-primary' : job ? 'bg-status-success-foreground' : 'bg-muted-foreground'}`} />
            </div>
          </div>
          <div className="px-4 py-4">
            <p className="font-mono text-xs text-muted-foreground">数据源</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums">
              {matchedPathCount}<span className="text-xs text-muted-foreground"> / {TOTAL_INPUT_COUNT}</span>
            </p>
          </div>
          <div className="px-4 py-4">
            <p className="font-mono text-xs text-muted-foreground">核对完成</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums">
              {comparisonCompleted}<span className="text-xs text-muted-foreground"> / {comparisonTotal}</span>
            </p>
          </div>
          <div className="px-4 py-4">
            <p className="font-mono text-xs text-muted-foreground">待处置 / 已复核</p>
            <p className={`mt-1 font-mono text-lg font-bold tabular-nums ${attentionCount > 0 ? 'text-primary' : ''}`}>
              {attentionCount}<span className="text-xs text-muted-foreground"> / {reviewedCount}</span>
            </p>
          </div>
        </div>
      </section>

      <section className="gsap-reveal border-b border-border">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3">
          <button
            type="button"
            onClick={() => setIsSourcesOpen(value => !value)}
            aria-expanded={isSourcesOpen}
            className="flex min-h-11 items-center gap-3 px-1 text-left font-bold tracking-tight text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {isSourcesOpen ? (
              <CaretDown weight="bold" className="size-4 text-primary" />
            ) : (
              <CaretRight weight="bold" className="size-4 text-primary" />
            )}
            数据源与任务设置
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {matchedPathCount}/{TOTAL_INPUT_COUNT} READY
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {isJobActive && (
              <button
                type="button"
                onClick={handleCancelJob}
                disabled={isCancelling || job?.status === 'cancel_requested'}
                className="flex min-h-11 items-center justify-center gap-2 border border-status-danger-foreground/50 px-4 font-bold text-status-danger-foreground outline-none transition-colors hover:bg-status-danger-surface focus-visible:ring-2 focus-visible:ring-status-danger-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isCancelling || job?.status === 'cancel_requested' ? (
                  <CircleNotch weight="bold" className="size-4 animate-spin" />
                ) : (
                  <XCircle weight="bold" className="size-4" />
                )}
                {job?.status === 'cancel_requested' ? '正在取消' : '取消任务'}
              </button>
            )}
            <button
              type="button"
              onClick={handleResetPage}
              disabled={resetDisabled || !hasResettableState}
              title="清空当前页面，并删除后台任务和已生成文件"
              className="flex min-h-11 items-center justify-center gap-2 border border-border px-4 font-bold text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isResettingPage ? (
                <CircleNotch weight="bold" className="size-4 animate-spin" />
              ) : (
                <ArrowCounterClockwise weight="bold" className="size-4" />
              )}
              {isResettingPage ? '正在重置' : '重置'}
            </button>
          </div>
        </div>

        {isSourcesOpen && (
          <div className="border-t border-border py-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <label className="flex min-h-11 min-w-0 items-center border border-border bg-background focus-within:border-primary">
                <span className="flex size-11 shrink-0 items-center justify-center border-r border-border text-primary">
                  <FolderOpen weight="bold" className="size-5" />
                </span>
                <input
                  type="text"
                  value={folderPath}
                  onChange={(event) => setFolderPath(event.target.value)}
                  disabled={isInputLocked}
                  placeholder="输入服务器文件夹路径，或从本机选择文件夹"
                  className="min-w-0 flex-1 bg-transparent px-3 font-mono text-base text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleSelectFolder}
                  disabled={isScanning || isStarting || isInputLocked}
                  className="flex min-h-11 items-center justify-center gap-2 border border-border bg-secondary px-4 font-bold text-secondary-foreground outline-none transition-colors hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FolderOpen weight="bold" className="size-4 text-primary" />
                  浏览
                </button>
                <button
                  type="button"
                  onClick={handleScanFolder}
                  disabled={isScanning || isStarting || isInputLocked || (!folderPath.trim() && selectedFilesRef.current.length === 0)}
                  className="flex min-h-11 items-center justify-center gap-2 border border-primary bg-primary/10 px-4 font-bold text-primary outline-none transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isScanning && <CircleNotch weight="bold" className="size-4 animate-spin" />}
                  扫描解析
                </button>
              </div>
            </div>

            <div className="mt-5 grid border-l border-t border-border md:grid-cols-2 xl:grid-cols-4">
              {SOURCE_GROUPS.map(group => (
                <div key={group.key} className="min-w-0 border-b border-r border-border px-4 py-4">
                  <h2 className="mb-2 font-bold tracking-tight">{group.label}</h2>
                  {group.fields.map(field => (
                    <UnboxedFileInput
                      key={field.key}
                      label={field.label}
                      value={paths[field.key]}
                      onChange={(value) => handlePathChange(field.key, value)}
                      disabled={isInputLocked}
                    />
                  ))}
                  <ModuleProgressBar label={`${group.label}上传`} progress={moduleProgress[group.key]} />
                </div>
              ))}
            </div>

            <div className="grid border-x border-b border-border md:grid-cols-[10rem_minmax(0,1fr)]">
              <div className="border-b border-border px-4 py-4 md:border-b-0 md:border-r">
                <p className="font-bold tracking-tight">配置文件</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">映射配置</p>
              </div>
              <div className="grid min-w-0 px-4 md:grid-cols-3 md:gap-5">
                {CONFIG_FIELDS.map(field => (
                  <UnboxedFileInput
                    key={field.key}
                    label={field.label}
                    value={paths[field.key]}
                    onChange={(value) => handlePathChange(field.key, value)}
                    disabled={isInputLocked}
                  />
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleCheck}
                disabled={isScanning || isStarting || isInputLocked}
                className="flex min-h-12 items-center justify-center gap-3 border-2 border-foreground px-7 text-base font-bold tracking-tight text-foreground outline-none transition-[background-color,color,transform] hover:bg-foreground hover:text-background focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isJobActive || isStarting ? (
                  <CircleNotch weight="bold" className="size-5 animate-spin" />
                ) : (
                  <CheckSquareOffset weight="bold" className="size-5" />
                )}
                {isStarting ? '正在创建任务' : job ? '重新核对' : '开始核对'}
              </button>
              <p className="font-mono text-xs text-muted-foreground">
                全部 {TOTAL_INPUT_COUNT} 项输入就绪后可启动；运行中的任务会自动恢复。
              </p>
            </div>
          </div>
        )}

        {(statusMsg || job || jobError || expiredJobId) && (
          <div className="border-t border-border bg-primary/5 px-4 py-3 font-mono text-xs" aria-live="polite">
            <div className="flex flex-col gap-2">
              {statusMsg && <div>{statusMsg}</div>}
              {expiredJobId && (
                <div className="text-status-warning-foreground">
                  <Badge variant="warn">已过期</Badge>{' '}
                  上次任务及文件已清理，请重新扫描并开始核对。
                </div>
              )}
              {job && (
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                  <span>验证 {job.progress.validation?.status === 'ready' ? '完成' : job.progress.validation?.status === 'failed' ? '失败' : '处理中'}</span>
                  <span>核对 {job.progress.comparison?.completed ?? 0}/{comparisonTotal}</span>
                  <span>模块文件 {job.progress.moduleArtifacts?.completed ?? 0}/{job.progress.moduleArtifacts?.total ?? comparisonTotal}</span>
                  <span>原始数据 {job.progress.rawData?.status === 'ready' ? '完成' : job.progress.rawData?.status === 'failed' ? '失败' : '生成中'}</span>
                </div>
              )}
              {(jobError || job?.error) && (
                <div className="text-status-danger-foreground">
                  <Badge variant="err">错误</Badge> {jobError || job?.error}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="gsap-reveal relative mt-5 min-w-0 bg-background">
        <div className="grid min-w-0 border-l border-t border-border min-[80rem]:h-[min(56rem,calc(100dvh-8rem))] min-[80rem]:min-h-[42rem] min-[80rem]:grid-cols-[15rem_minmax(0,1fr)_18rem]">
          <aside className="flex min-w-0 flex-col border-b border-r border-border bg-card/40 min-[80rem]:min-h-0">
            <div className="shrink-0 border-b border-border px-4 py-3 min-[80rem]:py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-bold">核对模块</h2>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {reviewedCount}/{checkResults.length || TOTAL_MODULE_COUNT} 已复核
                </span>
              </div>
            </div>
            <nav className="grid min-h-0 flex-1 grid-cols-2 min-[80rem]:block min-[80rem]:overflow-y-auto" aria-label="资产核对模块">
              {checkResults.length > 0 ? checkResults.map(result => {
                const isActive = activeResult?.key === result.key;
                const counts = result.counts ?? { new: 0, removed: 0, anomaly: 0 };
                const reviewSaved = Boolean(reviews[result.key]);
                const remarkMissing = result.has_diff && !remarks[result.key]?.trim();
                return (
                  <button
                    key={result.key}
                    type="button"
                    onClick={() => handleActiveResultChange(result.key)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`flex min-h-[4.75rem] w-full items-start gap-3 border-b border-r border-border px-3 py-3 text-left outline-none transition-[background-color,color] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary min-[80rem]:min-h-[4.25rem] min-[80rem]:gap-2.5 min-[80rem]:border-r-0 min-[80rem]:py-2.5 ${
                      isActive ? 'bg-primary/10' : 'hover:bg-secondary/60'
                    }`}
                  >
                    <span className={`mt-1.5 size-2 shrink-0 ${
                      result.status === 'failed'
                        ? 'bg-status-danger-foreground'
                        : result.status === 'pending' || result.status === 'running'
                          ? 'bg-primary'
                          : result.has_diff
                            ? 'bg-status-warning-foreground'
                            : 'bg-status-success-foreground'
                    }`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold">
                          {result.label.replace(/【|】/g, '')}
                        </span>
                        {reviewSaved && (
                          <CheckCircle weight="fill" className="size-4 shrink-0 text-status-success-foreground" aria-label="已复核" />
                        )}
                      </span>
                      <span className="mt-1.5 flex items-center gap-3 font-mono text-xs tabular-nums min-[80rem]:mt-1">
                        <span className="text-status-success-foreground">+{counts.new}</span>
                        <span className="text-status-danger-foreground">−{counts.removed}</span>
                        <span className={counts.anomaly ? 'text-status-warning-foreground' : 'text-muted-foreground'}>!{counts.anomaly}</span>
                      </span>
                      <span className={`mt-1 block truncate text-xs ${
                        remarkMissing ? 'text-status-warning-foreground' : 'text-muted-foreground'
                      }`}>
                        {result.status === 'failed'
                          ? '核对失败'
                          : result.status === 'running'
                            ? '正在核对'
                            : result.status === 'pending'
                              ? '等待执行'
                              : remarkMissing
                                ? '缺少异常原因'
                                : reviewSaved
                                  ? '结论已同步'
                                  : result.has_diff
                                    ? '等待复核'
                                    : '核对通过'}
                      </span>
                    </span>
                  </button>
                );
              }) : (
                <div className="px-4 py-8 text-sm leading-relaxed text-muted-foreground">
                  {isJobActive ? '正在建立核对队列…' : `准备 ${TOTAL_INPUT_COUNT} 项数据源并启动任务后，这里会显示${TOTAL_MODULE_COUNT}个核对模块。`}
                </div>
              )}
            </nav>
            <div className="shrink-0 border-t border-border px-4 py-4 min-[80rem]:py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold">来源健康</p>
                <span className="font-mono text-xs text-muted-foreground">{matchedPathCount}/{TOTAL_INPUT_COUNT}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {SOURCE_GROUPS.map(group => {
                  const ready = group.fields.filter(field => paths[field.key].trim()).length;
                  return (
                    <div key={group.key} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-muted-foreground">{group.label}</span>
                      <span className={`font-mono tabular-nums ${ready === group.fields.length ? 'text-status-success-foreground' : 'text-status-warning-foreground'}`}>
                        {ready}/{group.fields.length}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          <section
            aria-label="差异明细"
            className="flex min-w-0 flex-col border-b border-r border-border min-[80rem]:min-h-0"
          >
            {activeResult ? (
              <>
                <div className="shrink-0 border-b border-border px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold">
                        {activeResult.label.replace(/【|】/g, '')}
                      </p>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {activeResult.msg}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveActiveResult(-1)}
                        disabled={activeResultIndex <= 0}
                        aria-label="上一个核对模块"
                        className="flex size-11 items-center justify-center border border-border outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35 min-[80rem]:size-9"
                      >
                        <CaretLeft weight="bold" className="size-4 min-[80rem]:size-3.5" />
                      </button>
                      <span className="px-2 font-mono text-xs tabular-nums text-muted-foreground">
                        {activeResultIndex + 1}/{checkResults.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => moveActiveResult(1)}
                        disabled={activeResultIndex >= checkResults.length - 1}
                        aria-label="下一个核对模块"
                        className="flex size-11 items-center justify-center border border-border outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35 min-[80rem]:size-9"
                      >
                        <CaretRight weight="bold" className="size-4 min-[80rem]:size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="relative grid shrink-0 border-b border-border sm:grid-cols-2">
                  {activeSources.map((source, index) => (
                    <div
                      key={source.key}
                      className={`min-w-0 px-4 py-3 min-[80rem]:py-2.5 ${index === 0 ? 'border-b border-border sm:border-b-0 sm:border-r' : ''}`}
                    >
                      <div className="flex min-w-0 items-start gap-3 min-[80rem]:gap-2.5">
                        <FileXls weight="duotone" className="mt-0.5 size-5 shrink-0 text-primary min-[80rem]:size-4" />
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-muted-foreground">{source.label}</p>
                          <p className="mt-1 truncate text-sm font-medium min-[80rem]:mt-0.5" title={paths[source.key]}>
                            {getFileName(paths[source.key])}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground min-[80rem]:mt-0.5">
                            {job ? '任务快照已锁定' : '等待创建任务'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {activeSources.length === 2 && (
                    <span className="absolute left-1/2 top-1/2 hidden size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-border bg-background font-mono text-xs font-bold text-primary sm:flex">
                      VS
                    </span>
                  )}
                </div>

                <div className="grid shrink-0 grid-cols-2 border-b border-border sm:grid-cols-4">
                  {([
                    ['全部差异', activeCounts.all, 'text-foreground'],
                    ['异常', activeCounts.anomaly, 'text-status-warning-foreground'],
                    ['新增', activeCounts.new, 'text-status-success-foreground'],
                    ['减少', activeCounts.removed, 'text-status-danger-foreground'],
                  ] as const).map(([label, value, color], index) => (
                    <div key={label} className={`px-4 py-3 min-[80rem]:py-2.5 ${index < 3 ? 'border-r border-border' : ''} ${index < 2 ? 'border-b border-border sm:border-b-0' : ''}`}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className={`mt-1 font-mono text-xl font-bold tabular-nums min-[80rem]:mt-0.5 min-[80rem]:text-lg ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="grid grid-cols-4 border border-border">
                    {([
                      ['all', '全部'],
                      ['anomaly', '异常'],
                      ['new', '新增'],
                      ['removed', '减少'],
                    ] as Array<[DifferenceType, string]>).map(([type, label]) => (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={differenceType === type}
                        onClick={() => {
                          setDifferenceType(type);
                          setDifferencePage(0);
                        }}
                        className={`min-h-11 whitespace-nowrap border-r border-border px-2.5 text-xs font-bold outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary min-[60rem]:min-h-9 ${
                          differenceType === type ? 'bg-foreground text-background' : 'hover:bg-secondary'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="flex min-h-11 min-w-0 items-center border border-border bg-background focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary min-[60rem]:min-h-9 lg:w-56">
                    <MagnifyingGlass className="ml-2.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="sr-only">搜索差异明细</span>
                    <input
                      type="search"
                      value={differenceQuery}
                      onChange={(event) => {
                        setDifferenceQuery(event.target.value);
                        setDifferencePage(0);
                      }}
                      placeholder="资产编号、名称或保管人"
                      className="min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </label>
                </div>

                <div className="difference-scroll min-h-[24rem] flex-1 overflow-x-auto min-[80rem]:min-h-0 min-[80rem]:overflow-y-auto">
                  {activeResult.status === 'failed' ? (
                    <div className="m-5 border border-status-danger-foreground/50 p-5">
                      <p className="font-bold text-status-danger-foreground">本模块核对失败</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        请检查输入文件与任务状态，处理后重新启动核对。
                      </p>
                    </div>
                  ) : activeResult.status === 'pending' || activeResult.status === 'running' || !detailEnabled ? (
                    <div className="flex min-h-72 items-center justify-center px-6">
                      <LoadingSignal
                        ariaLabel={`${activeResult.label}正在核对`}
                        label="[ 正在比对资产记录 ]"
                        detail="全部模块完成后会开放逐行差异明细"
                      />
                    </div>
                  ) : isDifferenceLoading && !differenceData ? (
                    <div className="flex min-h-72 items-center justify-center px-6">
                      <LoadingSignal
                        ariaLabel="正在载入差异明细"
                        meta="Asset / Difference Details"
                        label="[ 差异明细 · 载入中 ]"
                        detail="正在拉取当前模块的逐行差异证据"
                      />
                    </div>
                  ) : differenceError ? (
                    <div className="m-5 border border-status-danger-foreground/50 p-5">
                      <p className="font-bold text-status-danger-foreground">差异明细载入失败</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{differenceError}</p>
                    </div>
                  ) : differenceData && differenceData.records.length > 0 ? (
                    <>
                      <div className="hidden min-[60rem]:block">
                        <table className="w-full border-collapse text-left text-sm">
                          <thead className="bg-background min-[80rem]:sticky min-[80rem]:top-0 min-[80rem]:z-10">
                            <tr className="border-b border-border text-xs text-muted-foreground">
                              <th className="px-4 py-3 font-medium">类型</th>
                              <th className="px-4 py-3 font-medium">资产 / 设备编号</th>
                              <th className="px-4 py-3 font-medium">名称</th>
                              <th className="px-4 py-3 font-medium">保管人 / DRI</th>
                              <th className="px-4 py-3 font-medium">差异维度</th>
                              <th className="px-4 py-3 font-medium">说明</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {differenceData.records.map(record => (
                              <tr key={record.id} className="align-top hover:bg-secondary/50">
                                <td className="px-4 py-3">
                                  <span className={`inline-flex whitespace-nowrap px-2 py-1 font-mono text-xs font-bold ${
                                    record.changeType === 'anomaly'
                                      ? 'bg-status-warning-surface text-status-warning-foreground'
                                      : record.changeType === 'new'
                                        ? 'bg-status-success-surface text-status-success-foreground'
                                        : 'bg-status-danger-surface text-status-danger-foreground'
                                  }`}>
                                    {record.changeType === 'anomaly' ? '异常' : record.changeType === 'new' ? '新增' : '减少'}
                                  </span>
                                </td>
                                <td className="max-w-48 px-4 py-3 font-mono font-bold break-all">{record.identifier || '—'}</td>
                                <td className="max-w-48 px-4 py-3">{record.name || '—'}</td>
                                <td className="max-w-40 px-4 py-3">{record.owner || '—'}</td>
                                <td className="px-4 py-3 text-muted-foreground">{record.dimension}</td>
                                <td className="max-w-64 px-4 py-3 text-muted-foreground">{record.detail}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="divide-y divide-border min-[60rem]:hidden">
                        {differenceData.records.map(record => (
                          <article key={record.id} className="px-4 py-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-all font-mono text-sm font-bold">{record.identifier || '未提供编号'}</p>
                                <p className="mt-1 text-sm text-muted-foreground">{record.name || record.dimension}</p>
                              </div>
                              <span className={`shrink-0 px-2 py-1 font-mono text-xs font-bold ${
                                record.changeType === 'anomaly'
                                  ? 'bg-status-warning-surface text-status-warning-foreground'
                                  : record.changeType === 'new'
                                    ? 'bg-status-success-surface text-status-success-foreground'
                                    : 'bg-status-danger-surface text-status-danger-foreground'
                              }`}>
                                {record.changeType === 'anomaly' ? '异常' : record.changeType === 'new' ? '新增' : '减少'}
                              </span>
                            </div>
                            <dl className="mt-3 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                              <dt className="text-muted-foreground">保管人 / DRI</dt>
                              <dd>{record.owner || '—'}</dd>
                              <dt className="text-muted-foreground">差异维度</dt>
                              <dd>{record.dimension}</dd>
                              <dt className="text-muted-foreground">证据来源</dt>
                              <dd>{record.sourceLabel}</dd>
                              <dt className="text-muted-foreground">说明</dt>
                              <dd>{record.detail}</dd>
                            </dl>
                          </article>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex min-h-72 items-center justify-center px-6 text-center">
                      <div>
                        <CheckSquareOffset weight="thin" className="mx-auto size-10 text-status-success-foreground" />
                        <p className="mt-3 font-bold">
                          {activeCounts.all === 0 ? '本模块没有差异' : '当前筛选没有匹配记录'}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {activeCounts.all === 0
                            ? '两侧数据已完成核对，可在右侧确认审核结论。'
                            : '清除关键词或切换差异类型后继续查看。'}
                        </p>
                        {activeCounts.all > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setDifferenceType('all');
                              setDifferenceQuery('');
                              setDifferencePage(0);
                            }}
                            className="mt-4 min-h-11 border border-border px-4 font-bold outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            清除筛选
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 min-[80rem]:py-2">
                  <p className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
                    {isDifferenceLoading && !differenceData
                      ? '正在载入差异明细…'
                      : differenceData
                        ? `显示 ${differenceData.records.length} / ${differenceData.filteredTotal} 条`
                        : '等待差异明细'}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDifferencePage(page => Math.max(0, page - 1))}
                      disabled={differencePage <= 0}
                      className="flex min-h-11 items-center gap-1 border border-border px-3 text-sm font-bold outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35 min-[80rem]:min-h-9 min-[80rem]:px-2.5 min-[80rem]:text-xs"
                    >
                      <CaretLeft className="size-4 min-[80rem]:size-3.5" /> 上一页
                    </button>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {differencePage + 1}/{differencePageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDifferencePage(page => Math.min(differencePageCount - 1, page + 1))}
                      disabled={differencePage >= differencePageCount - 1}
                      className="flex min-h-11 items-center gap-1 border border-border px-3 text-sm font-bold outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35 min-[80rem]:min-h-9 min-[80rem]:px-2.5 min-[80rem]:text-xs"
                    >
                      下一页 <CaretRight className="size-4 min-[80rem]:size-3.5" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-[32rem] flex-1 items-center justify-center px-6 text-center">
                <div>
                  <Database weight="thin" className="mx-auto size-12 text-muted-foreground" />
                  <p className="mt-4 text-lg font-bold">等待核对结果</p>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    准备数据源并启动任务后，这里会显示逐行差异证据。
                  </p>
                </div>
              </div>
            )}
          </section>

          <aside className="min-w-0 border-b border-r border-border bg-card/40 min-[80rem]:min-h-0 min-[80rem]:overflow-y-auto">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-bold">处置与归档</h2>
                <span className="font-mono text-xs text-muted-foreground">
                  {activeResult ? activeResult.key.toUpperCase() : '—'}
                </span>
              </div>
            </div>

            {activeResult ? (
              <>
                <fieldset className="border-b border-border px-4 py-4 min-[80rem]:py-3" disabled={activeResult.status !== 'ready'}>
                  <legend className="text-xs font-bold">审核结论</legend>
                  <div className="relative mt-3 min-[80rem]:mt-2">
                    <select
                      id={`review-${activeResult.key}`}
                      value={reviews[activeResult.key] || REVIEW_OPTIONS[0]}
                      onChange={(event) => handleReviewChange(activeResult.key, event.target.value)}
                      className="min-h-11 w-full appearance-none border border-border bg-background px-3 pr-10 text-sm font-bold outline-none transition-colors hover:border-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 min-[80rem]:min-h-9"
                    >
                      {REVIEW_OPTIONS.map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <CaretDown
                      aria-hidden="true"
                      weight="bold"
                      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                  </div>
                </fieldset>

                <div className="border-b border-border px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={`remark-${activeResult.key}`} className="text-xs font-bold">
                      异常原因{activeResult.has_diff ? '（必填）' : ''}
                    </label>
                    <span className={`text-xs ${activeResult.has_diff && !remarks[activeResult.key]?.trim() ? 'text-status-warning-foreground' : 'text-muted-foreground'}`}>
                      {activeResult.has_diff && !remarks[activeResult.key]?.trim() ? '尚未填写' : '可随时补充'}
                    </span>
                  </div>
                  <textarea
                    id={`remark-${activeResult.key}`}
                    value={remarks[activeResult.key] || ''}
                    onChange={(event) => handleRemarkChange(activeResult.key, event.target.value)}
                    onBlur={handleRemarkBlur}
                    disabled={activeResult.status !== 'ready'}
                    aria-required={activeResult.has_diff}
                    className="mt-3 min-h-28 w-full resize-y border border-border bg-background p-3 text-base leading-relaxed outline-2 outline-transparent outline-offset-1 placeholder:text-muted-foreground focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                    placeholder={activeResult.has_diff ? '记录原因、责任人和后续动作' : '本模块无差异，可留空'}
                  />
                  <p className={`mt-2 min-h-4 font-mono text-xs ${
                    annotationSaveStatus === 'error'
                      ? 'text-status-danger-foreground'
                      : annotationsDirty
                        ? 'text-status-warning-foreground'
                        : 'text-muted-foreground'
                  }`} aria-live="polite">
                    {annotationStatusLabel || `上次同步 ${formatTimestamp(job?.updatedAt)}`}
                  </p>
                </div>

                <div className="border-b border-border">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <FileXls weight="duotone" className="size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">模块差异文件</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {formatBytes(activeArtifact?.sizeBytes)} · {activeArtifact?.status ?? 'blocked'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleExportSingle(activeResult.key)}
                      disabled={
                        retryingArtifact === activeArtifactKey
                        || !['ready', 'failed'].includes(activeArtifact?.status ?? '')
                      }
                      title={activeArtifact?.error}
                      aria-label={activeArtifact?.status === 'failed' ? '重新生成模块差异文件' : '下载模块差异文件'}
                      className="flex size-11 shrink-0 items-center justify-center border border-border outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {retryingArtifact === activeArtifactKey || activeArtifactBusy ? (
                        <CircleNotch className="size-4 animate-spin" />
                      ) : activeArtifact?.status === 'failed' ? (
                        <ArrowClockwise className="size-4" />
                      ) : (
                        <DownloadSimple className="size-4" />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 border-t border-border px-4 py-3">
                    <Database weight="duotone" className="size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">原始数据汇总</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {formatBytes(rawArtifact?.sizeBytes)} · {rawArtifact?.status ?? 'blocked'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => download('raw_data_xlsx')}
                      disabled={rawArtifact?.status !== 'ready'}
                      aria-label="下载原始数据汇总"
                      className="flex size-11 shrink-0 items-center justify-center border border-border outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {rawArtifact?.status === 'building' ? (
                        <CircleNotch className="size-4 animate-spin" />
                      ) : (
                        <DownloadSimple className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="border-b border-border px-4 py-4">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-bold">复核进度</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{reviewedCount}/{checkResults.length}</span>
                  </div>
                  <div className="mt-3 h-1.5 bg-border">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${checkResults.length ? (reviewedCount / checkResults.length) * 100 : 0}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      // 避免 textarea blur 触发的 saving 状态在 click 前禁用本按钮
                      event.preventDefault();
                    }}
                    onClick={handleSaveAndNext}
                    disabled={!job || activeResult.status !== 'ready' || annotationSaveStatus === 'saving'}
                    className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 border border-foreground px-4 text-sm font-bold outline-none transition-[background-color,color,transform] hover:bg-foreground hover:text-background focus-visible:ring-2 focus-visible:ring-primary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {annotationSaveStatus === 'saving' ? (
                      <CircleNotch className="size-4 animate-spin" />
                    ) : (
                      <FloppyDisk className="size-4" />
                    )}
                    {activeResultIndex < checkResults.length - 1 ? '保存并下一项' : '保存当前复核'}
                  </button>
                </div>
              </>
            ) : (
              <p className="border-b border-border px-4 py-8 text-sm leading-relaxed text-muted-foreground">
                选择一个核对模块后，可填写审核结论和异常原因。
              </p>
            )}

            <div className="px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold">完整归档包</p>
                {localMissingRemarks.length > 0 && (
                  <span className="font-mono text-xs text-status-warning-foreground">{localMissingRemarks.length} 项待补</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={finalButtonDisabled}
                title={finalArtifact?.error}
                className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 bg-primary px-4 text-sm font-bold text-primary-foreground outline-none transition-[background-color,transform] hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
              >
                {finalIsBuilding ? (
                  <CircleNotch weight="bold" className="size-5 shrink-0 animate-spin" />
                ) : finalButtonIsDownload ? (
                  <DownloadSimple weight="bold" className="size-5 shrink-0" />
                ) : finalArtifact?.status === 'failed' ? (
                  <ArrowClockwise weight="bold" className="size-5 shrink-0" />
                ) : (
                  <FloppyDisk weight="bold" className="size-5 shrink-0" />
                )}
                <span className="truncate">{finalButtonLabel}</span>
              </button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
};

export default AssetComparison;
