import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { FileArrowUp, CheckSquareOffset, FloppyDisk, DownloadSimple, Plus, Minus, Warning, FolderOpen, CircleNotch, ArrowClockwise, ArrowCounterClockwise } from '@phosphor-icons/react';
import api from '../../../api/axios';
import { LoadingSignal } from '../../../components/LoadingSignal';
import { useTusUpload } from '../../../hooks/useTusUpload';
import type { AssetComparisonInputs } from './types';
import { useAssetComparisonJob } from './useAssetComparisonJob';

const UnboxedFileInput: React.FC<{
  label: string;
  value: string;
  onChange: (val: string) => void;
  displayValue?: string;
  disabled?: boolean;
}> = ({ label, value, onChange, displayValue, disabled = false }) => {
  const [isFocused, setIsFocused] = useState(false);
  const shown = displayValue ?? (value.includes('/') ? value.split('/').pop()! : value.includes('\\') ? value.split('\\').pop()! : value);

  return (
    <div className="relative group w-full mb-8">
      <div className={`pointer-events-none absolute left-0 top-2 font-mono uppercase tracking-[0.1em] text-muted-foreground transition-[color,transform] duration-300 ease-out ${isFocused || shown ? '-translate-y-7 text-[0.625rem] text-primary' : 'translate-y-0 text-sm'}`}>
        {label}
      </div>
      <div className="flex items-center border-b border-border group-focus-within:border-primary transition-colors">
        <input
          type="text"
          value={shown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full bg-transparent border-none outline-none py-1.5 text-base md:text-lg font-medium tracking-wide text-foreground truncate disabled:cursor-not-allowed disabled:opacity-60"
          placeholder=""
        />
        <button
          disabled={disabled}
          className="p-1.5 text-muted-foreground hover:text-primary transition-colors active:scale-95 flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          title="选择文件"
        >
          <FileArrowUp weight="bold" className="size-5" />
        </button>
      </div>
    </div>
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

const REVIEW_OPTIONS = ["差異確認OK", "待跟进", "異常"];
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

function createEmptyModuleProgress(): Record<ModuleKey, ModuleProgress> {
  return {
    finance: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
    sfc: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
    notes: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
    customer: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
  };
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

// 状态徽章小组件
const Badge: React.FC<{ variant: 'ok' | 'warn' | 'err' | 'info'; children: React.ReactNode }> = ({ variant, children }) => {
  const colors: Record<string, string> = {
    ok: 'border-green-500/40 text-green-400 bg-green-500/10',
    warn: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
    err: 'border-red-500/40 text-red-400 bg-red-500/10',
    info: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[0.65rem] font-mono font-bold uppercase tracking-wider ${colors[variant]}`}>
      {children}
    </span>
  );
};

const ModuleProgressBar: React.FC<{ label: string; progress: ModuleProgress }> = ({ label, progress }) => {
  if (progress.fileCount === 0 && progress.total === 0) return null;
  const sentPct = progress.total > 0 ? Math.min((progress.loaded / progress.total) * 100, 100) : 0;
  const acceptedPct = progress.total > 0 ? Math.min((progress.accepted / progress.total) * 100, 100) : 0;
  const done = progress.okCount + progress.failCount >= progress.fileCount;
  const color = done ? (progress.failCount > 0 ? 'bg-amber-400' : 'bg-green-400') : 'bg-primary';
  const isConfirming = !done && sentPct >= 100 && acceptedPct < 100;
  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <div className="flex items-center justify-between text-xs font-mono mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">
          {progress.okCount}/{progress.fileCount}
          {progress.failCount > 0 && <span className="text-amber-400 ml-1">({progress.failCount}失败)</span>}
        </span>
      </div>
      <div className="relative h-1.5 bg-border/50 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/30 transition-all duration-300"
          style={{ width: `${sentPct}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${color}`}
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
        <p className="mt-2 text-[0.625rem] tabular-nums text-muted-foreground">
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
  const [isStartingJob, setIsStartingJob] = useState(false);
  const [isFinalizingAction, setIsFinalizingAction] = useState(false);
  const [isResettingPage, setIsResettingPage] = useState(false);
  const [retryingArtifact, setRetryingArtifact] = useState('');
  const restoredJobRef = useRef('');
  const {
    job,
    error: jobError,
    start,
    saveAnnotations,
    finalize,
    retry,
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

  useEffect(() => {
    if (!job || restoredJobRef.current === job.jobId) return;
    restoredJobRef.current = job.jobId;
    setPaths(job.inputs);
    setRemarks(job.remarks);
    setReviews(job.reviews);
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
              <span className="text-amber-400 text-xs">⚠ {failMsgs.length} 个文件上传失败</span>
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
    if (isStartingJob || isJobActive || isResettingPage) return;
    const hasMissingPath = Object.values(paths).some(value => !value.trim());
    if (hasMissingPath) {
      setStatusMsg(
        <span><Badge variant="warn">提示</Badge> 请先补齐全部输入文件</span>,
      );
      return;
    }

    setStatusMsg('正在创建核对任务...');
    setIsStartingJob(true);
    setRemarks({});
    setReviews({});
    try {
      await start(paths);
      setStatusMsg('');
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">错误</Badge> 请求: {getErrorMessage(err)}</span>);
    } finally {
      setIsStartingJob(false);
    }
  };

  const handleSaveAll = async () => {
    if (!job || isFinalizingAction) return;
    const currentFinalArtifact = job.artifacts.final_bundle;
    if (
      currentFinalArtifact?.status === 'ready'
      && job.finalizedRevision === job.annotationRevision
      && !annotationsDirty
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
    setIsFinalizingAction(true);
    try {
      await saveAnnotations(remarks, reviews);
      await finalize();
      setStatusMsg('');
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">失败</Badge> {getErrorMessage(err)}</span>);
    } finally {
      setIsFinalizingAction(false);
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
      setRetryingArtifact(artifactKey);
      await retry(artifactKey);
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">失败</Badge> {getErrorMessage(err)}</span>);
    } finally {
      setRetryingArtifact('');
    }
  };

  const handleRemarkBlur = () => {
    if (job) {
      void saveAnnotations(remarks, reviews).catch(() => undefined);
    }
  };

  const resetDisabled = Boolean(
    isScanning
    || isStartingJob
    || isJobActive
    || isFinalizingAction
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
      setRetryingArtifact('');
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
    || ['ready', 'stale', 'failed'].includes(finalArtifact?.status ?? ''),
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
  const hasNonAnnotationBlocker = Boolean(
    job?.finalizeBlockers.some(blocker => blocker.code !== 'missing_remarks'),
  );
  const canPrepareFinal = Boolean(
    job && !hasNonAnnotationBlocker && localMissingRemarks.length === 0,
  );
  const finalButtonIsDownload = Boolean(
    finalArtifact?.status === 'ready'
    && job?.finalizedRevision === job?.annotationRevision
    && !annotationsDirty,
  );
  const finalButtonDisabled = Boolean(
    !job
    || isFinalizingAction
    || finalArtifact?.status === 'building'
    || (!finalButtonIsDownload && inputsChanged)
    || (!finalButtonIsDownload && !canPrepareFinal),
  );
  const finalButtonLabel = (() => {
    if (!job) return '等待核对';
    if (finalArtifact?.status === 'building') return '正在生成对比总结与 PDF';
    if (finalButtonIsDownload) return '下载完整结果';
    if (inputsChanged) return '输入已更改，请重新核对';
    if (localMissingRemarks.length > 0) {
      return `请填写 ${localMissingRemarks.length} 项异常原因`;
    }
    if (
      hasGeneratedFinal
      && (annotationsDirty || ['stale', 'failed'].includes(finalArtifact?.status ?? ''))
    ) {
      return '内容已更新，重新生成总结与 PDF';
    }
    return job.finalizeBlockers.find(
      blocker => blocker.code !== 'missing_remarks',
    )?.message ?? '生成对比总结与 PDF';
  })();

  return (
    <div ref={containerRef} className="flex w-full flex-col pb-20">
      <div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-center md:justify-between">
        <p className="gsap-reveal font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
          [ ASSET COMPARISON V1.2.7 INTERFACE ]
        </p>

        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory 是非标准属性
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={handleFolderChange}
        />

        <div className="gsap-reveal flex items-center gap-3">
          <button
            onClick={handleSelectFolder}
            disabled={isScanning || isStartingJob || isInputLocked}
            title="选择文件夹"
            className="flex items-center justify-center gap-2 border border-border bg-secondary px-4 py-3 font-bold uppercase tracking-tight text-secondary-foreground transition-[background-color,transform] hover:bg-secondary/80 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
          >
            <FolderOpen weight="bold" className="size-5 text-primary" />
            浏览
          </button>
          <input
            type="text"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            disabled={isInputLocked}
            placeholder="输入或粘贴文件夹路径..."
            className="flex-1 min-w-[240px] border-b border-border bg-transparent px-2 py-2 font-mono text-sm outline-none transition-colors focus:border-primary text-foreground placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            onClick={handleScanFolder}
            disabled={isScanning || isStartingJob || isInputLocked || (!folderPath.trim() && selectedFilesRef.current.length === 0)}
            className="flex items-center justify-center gap-2 border border-primary bg-primary/10 px-5 py-3 font-bold uppercase tracking-tight text-primary transition-[background-color,transform] hover:bg-primary/20 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 shrink-0"
          >
            扫描解析
          </button>
        </div>
      </div>

      <div className="w-full max-w-6xl relative z-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-6">

        {/* Finance */}
        <div className="gsap-reveal bg-card p-6 border border-border transition-colors transition-shadow hover:border-primary/30 hover:shadow-[0_2px_16px_rgba(var(--primary-rgb),0.06)]">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">财务 (Finance)</h2>
          <UnboxedFileInput label="本期财务数据" value={paths.thisFinance} onChange={(val) => handlePathChange('thisFinance', val)} disabled={isInputLocked} />
          <UnboxedFileInput label="上期财务数据" value={paths.lastFinance} onChange={(val) => handlePathChange('lastFinance', val)} disabled={isInputLocked} />
          <ModuleProgressBar label="财务上传" progress={moduleProgress.finance} />
        </div>

        {/* SFC */}
        <div className="gsap-reveal bg-card p-6 border border-border transition-colors transition-shadow hover:border-primary/30 hover:shadow-[0_2px_16px_rgba(var(--primary-rgb),0.06)]">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">SFC (System)</h2>
          <UnboxedFileInput label="本期SFC数据" value={paths.thisSFC} onChange={(val) => handlePathChange('thisSFC', val)} disabled={isInputLocked} />
          <UnboxedFileInput label="上期SFC数据" value={paths.lastSFC} onChange={(val) => handlePathChange('lastSFC', val)} disabled={isInputLocked} />
          <ModuleProgressBar label="SFC上传" progress={moduleProgress.sfc} />
        </div>

        {/* Notes */}
        <div className="gsap-reveal bg-card p-6 border border-border transition-colors transition-shadow hover:border-primary/30 hover:shadow-[0_2px_16px_rgba(var(--primary-rgb),0.06)]">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">Notes (IT)</h2>
          <UnboxedFileInput label="本期Notes数据" value={paths.thisNotes} onChange={(val) => handlePathChange('thisNotes', val)} disabled={isInputLocked} />
          <UnboxedFileInput label="上期Notes数据" value={paths.lastNotes} onChange={(val) => handlePathChange('lastNotes', val)} disabled={isInputLocked} />
          <ModuleProgressBar label="Notes上传" progress={moduleProgress.notes} />
        </div>

        {/* Customer */}
        <div className="gsap-reveal bg-card p-6 border border-border transition-colors transition-shadow hover:border-primary/30 hover:shadow-[0_2px_16px_rgba(var(--primary-rgb),0.06)]">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">客户 (Customer)</h2>
          <UnboxedFileInput label="本期客户数据" value={paths.thisCustomer} onChange={(val) => handlePathChange('thisCustomer', val)} disabled={isInputLocked} />
          <UnboxedFileInput label="上期客户数据" value={paths.lastCustomer} onChange={(val) => handlePathChange('lastCustomer', val)} disabled={isInputLocked} />
          <ModuleProgressBar label="客户上传" progress={moduleProgress.customer} />
        </div>

        {/* Config / TXT */}
        <div className="gsap-reveal bg-card p-6 border border-border lg:col-span-2 transition-colors transition-shadow hover:border-primary/30 hover:shadow-[0_2px_16px_rgba(var(--primary-rgb),0.06)]">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">配置项 (Config TXT)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8">
            <UnboxedFileInput label="保管部门配置" value={paths.departmentData} onChange={(val) => handlePathChange('departmentData', val)} disabled={isInputLocked} />
            <UnboxedFileInput label="保管人配置" value={paths.custodianData} onChange={(val) => handlePathChange('custodianData', val)} disabled={isInputLocked} />
            <UnboxedFileInput label="客户DRI配置" value={paths.driData} onChange={(val) => handlePathChange('driData', val)} disabled={isInputLocked} />
          </div>
        </div>

      </div>

      <div className="pt-8 flex flex-col sm:flex-row gap-6 max-w-6xl justify-start gsap-reveal border-b-2 border-border pb-8 mb-8">
        <button
          onClick={handleCheck}
          disabled={isScanning || isStartingJob || isInputLocked}
          className="flex items-center justify-center gap-3 border-2 border-border px-10 py-4 text-lg font-bold uppercase tracking-tighter text-foreground transition-[background-color,color,transform] hover:bg-foreground hover:text-background active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isJobActive || isStartingJob ? (
            <>
              <CircleNotch weight="bold" className="size-6 animate-spin" />
              {isStartingJob ? '正在创建任务' : `核对中 ${job?.progress.comparison?.completed ?? 0}/${job?.progress.comparison?.total ?? 7}`}
            </>
          ) : (
            <>
              <CheckSquareOffset weight="bold" className="size-6" />
              {job ? '重新核对' : '开始核对'}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={handleResetPage}
          disabled={resetDisabled || !hasResettableState}
          title="清空当前页面，并删除后台任务和已生成文件"
          className="flex items-center justify-center gap-2 border border-border px-6 py-4 font-bold uppercase tracking-tight text-muted-foreground transition-[background-color,color,transform] hover:bg-secondary hover:text-foreground active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isResettingPage ? (
            <CircleNotch weight="bold" className="size-5 animate-spin" />
          ) : (
            <ArrowCounterClockwise weight="bold" className="size-5" />
          )}
          {isResettingPage ? '正在重置' : '重置页面'}
        </button>
        {(statusMsg || job || jobError) && (
          <div className="flex-1 p-4 bg-primary/10 text-primary font-mono text-sm max-w-2xl flex flex-col gap-2">
            {statusMsg && <div>{statusMsg}</div>}
            {job && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                <span>文件验证</span>
                <span>{job.progress.validation?.status === 'ready' ? '完成' : '处理中'}</span>
                <span>资产核对</span>
                <span>{job.progress.comparison?.completed ?? 0}/{job.progress.comparison?.total ?? 7}</span>
                <span>模块文件</span>
                <span>{job.progress.moduleArtifacts?.completed ?? 0}/{job.progress.moduleArtifacts?.total ?? 7}</span>
                <span>原始数据</span>
                <span>{job.progress.rawData?.status === 'ready' ? '完成' : job.progress.rawData?.status === 'failed' ? '失败' : '生成中'}</span>
              </div>
            )}
            {(jobError || job?.error) && (
              <div className="text-red-400">
                <Badge variant="err">错误</Badge> {jobError || job?.error}
              </div>
            )}
          </div>
        )}
      </div>

      {checkResults.length > 0 && (
        <div className="max-w-6xl space-y-6 gsap-reveal mb-12">
          <h2 className="text-3xl font-bold tracking-tighter uppercase mb-6 flex items-center gap-4">
            <div className="size-4 rounded-full bg-primary"></div>
            核对结果明细
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {checkResults.map((res) => (
              <div key={res.key} className={`p-6 border-2 ${res.status === 'failed' ? 'border-red-500 bg-red-500/5' : res.has_diff ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
                <div className="flex justify-between items-start mb-4">
                  <div className="w-full">
                    <div className="flex justify-between items-center w-full mb-2">
                      <h3 className="text-xl font-bold">{res.label}</h3>
                      <select
                        value={reviews[res.key] || REVIEW_OPTIONS[0]}
                        onChange={(e) => handleReviewChange(res.key, e.target.value)}
                        className="cursor-pointer border border-border bg-background px-3 py-1 font-mono text-base outline-none focus:border-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 md:text-sm"
                      >
                        {REVIEW_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                    <p className={`font-mono mt-1 ${res.status === 'failed' ? 'text-red-400' : res.has_diff ? 'text-primary' : 'text-muted-foreground'}`}>{res.msg}</p>
                    {res.sub_groups && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        {res.sub_groups.map((sg) => (
                          <div key={sg.label} className={`p-3 border ${sg.has_diff ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{sg.label}</h4>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
                              <span className="flex items-center gap-1 text-green-600">
                                <Plus weight="bold" className="size-3.5" /> 本月新增 {sg.new_count}
                              </span>
                              <span className="flex items-center gap-1 text-red-500">
                                <Minus weight="bold" className="size-3.5" /> 本月减少 {sg.removed_count}
                              </span>
                              {sg.anomaly_count > 0 ? (
                                <span className="flex items-center gap-1 text-amber-500">
                                  <Warning weight="bold" className="size-3.5" /> 异常 {sg.anomaly_count}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-muted-foreground">
                                  <Warning weight="bold" className="size-3.5" /> 异常 0
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleExportSingle(res.key)}
                    disabled={retryingArtifact === `module_${res.key}` || !['ready', 'failed'].includes(job?.artifacts[`module_${res.key}`]?.status ?? '')}
                    className="p-2 border border-border hover:bg-foreground hover:text-background transition-colors flex-shrink-0 ml-4 disabled:cursor-not-allowed disabled:opacity-50"
                    title={job?.artifacts[`module_${res.key}`]?.error ?? `单独导出${res.label.replace(/【|】/g, '')}结果`}
                  >
                    {retryingArtifact === `module_${res.key}` ? (
                      <CircleNotch className="size-5 animate-spin" />
                    ) : job?.artifacts[`module_${res.key}`]?.status === 'failed' ? (
                      <ArrowClockwise className="size-5" />
                    ) : job?.artifacts[`module_${res.key}`]?.status === 'ready' ? (
                      <DownloadSimple className="size-5" />
                    ) : (
                      <CircleNotch className="size-5 animate-spin" />
                    )}
                  </button>
                </div>

                {res.has_diff && (
                  <div className="mt-4">
                    <label className="text-xs uppercase tracking-widest text-primary mb-2 block font-mono">请填写异常原因 (必填):</label>
                    <textarea
                      value={remarks[res.key] || ''}
                      onChange={(e) => handleRemarkChange(res.key, e.target.value)}
                      onBlur={handleRemarkBlur}
                      className="w-full resize-none border border-border bg-background p-3 font-mono text-base outline-none transition-colors focus:border-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 md:text-sm"
                      rows={2}
                      placeholder="发现差异，请备注原因..."
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="pt-8 flex justify-end">
            <button
              onClick={handleSaveAll}
              disabled={finalButtonDisabled}
              className="flex items-center justify-center gap-3 bg-primary px-12 py-4 text-xl font-bold uppercase tracking-tighter text-primary-foreground transition-[background-color,transform] hover:bg-primary/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            >
              {finalArtifact?.status === 'building' ? (
                <CircleNotch weight="bold" className="size-6 animate-spin" />
              ) : finalButtonIsDownload ? (
                <DownloadSimple weight="bold" className="size-6" />
              ) : (
                <FloppyDisk weight="bold" className="size-6" />
              )}
              {finalButtonLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetComparison;
