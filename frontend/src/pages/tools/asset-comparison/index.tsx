import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { FileArrowUp, CheckSquareOffset, FloppyDisk, DownloadSimple, Plus, Minus, Warning, FolderOpen } from '@phosphor-icons/react';
import api from '../../../api/axios';
import { LoadingSignal } from '../../../components/LoadingSignal';
import { useTusUpload } from '../../../hooks/useTusUpload';

const UnboxedFileInput: React.FC<{ label: string; value: string; onChange: (val: string) => void; displayValue?: string }> = ({ label, value, onChange, displayValue }) => {
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
          className="w-full bg-transparent border-none outline-none py-1.5 text-base md:text-lg font-medium tracking-wide text-foreground truncate"
          placeholder=""
        />
        <button
          className="p-1.5 text-muted-foreground hover:text-primary transition-colors active:scale-95 flex-shrink-0"
          title="选择文件"
        >
          <FileArrowUp weight="bold" className="size-5" />
        </button>
      </div>
    </div>
  );
};

interface SubGroup {
  label: string;
  new_count: number;
  removed_count: number;
  anomaly_count: number;
  has_diff: boolean;
}

interface CheckResult {
  key: string;
  label: string;
  has_diff: boolean;
  msg: string;
  sub_groups?: SubGroup[];
}

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

  const [paths, setPaths] = useState({
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
    driData: ''
  });

  const [folderPath, setFolderPath] = useState('');
  const selectedFilesRef = useRef<File[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [checkResults, setCheckResults] = useState<CheckResult[]>([]);
  const [statusMsg, setStatusMsg] = useState<React.ReactNode>('');
  const [isProcessing, setIsProcessing] = useState(false);

  const [moduleProgress, setModuleProgress] = useState<Record<ModuleKey, ModuleProgress>>({
    finance: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
    sfc: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
    notes: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
    customer: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
  });

  const { upload } = useTusUpload();

  const handlePathChange = (key: keyof typeof paths, value: string) => {
    setPaths(prev => ({ ...prev, [key]: value }));
  };

  const handleRemarkChange = (key: string, value: string) => {
    setRemarks(prev => ({ ...prev, [key]: value }));
  };

  const handleReviewChange = (key: string, value: string) => {
    setReviews(prev => ({ ...prev, [key]: value }));
  };

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
    const fileArr = selectedFilesRef.current;

    if (fileArr.length > 0) {
      setIsProcessing(true);
      const initProgress: Record<ModuleKey, ModuleProgress> = {
        finance: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
        sfc: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
        notes: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
        customer: { loaded: 0, accepted: 0, total: 0, fileCount: 0, okCount: 0, failCount: 0 },
      };

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
        setIsProcessing(false);
        selectedFilesRef.current = [];
      }
      return;
    }

    if (!folderPath.trim()) {
      setStatusMsg(<span><Badge variant="warn">提示</Badge> 请先选择文件夹或输入服务器上的文件夹路径</span>);
      return;
    }
    setIsProcessing(true);
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
      setIsProcessing(false);
    }
  };

  const handleCheck = async () => {
    setIsProcessing(true);
    setStatusMsg('正在核对数据，请稍候...');
    setCheckResults([]);
    setReviews({});
    try {
      const res = await api.post('/tools/asset/check', { ...paths, remarks, reviews });

      if (res.data.status === 'error') {
        setStatusMsg(
          <span><Badge variant="err">错误</Badge> {res.data.message}{"\n"}{res.data.errors?.join(' | ') || ''}</span>
        );
      } else {
        const resData: CheckResult[] = res.data.data.results || [];
        setCheckResults(resData);
        const newReviews: Record<string, string> = {};
        resData.forEach(r => newReviews[r.key] = REVIEW_OPTIONS[0]);
        setReviews(newReviews);

        setStatusMsg(
          <div className="font-bold text-green-500">
            <Badge variant="ok">核对完成</Badge> 请在下方填写有差异项的异常原因并选择审核状态。
          </div>
        );
      }
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">错误</Badge> 请求: {getErrorMessage(err)}</span>);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveAll = async () => {
    const missingRemarks = checkResults.filter(r => r.has_diff && !remarks[r.key]?.trim());
    if (missingRemarks.length > 0) {
      alert(`请先填写以下有差异模块的异常原因：\n${missingRemarks.map(r => r.label.replace(/【|】/g, '')).join(', ')}`);
      return;
    }

    setIsProcessing(true);
    setStatusMsg('正在生成完整对比总结、PDF及原始数据...');
    try {
      const res = await fetch('/api/v1/tools/asset/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...paths, remarks, reviews }),
      });

      if (!res.ok) {
        let errMsg = `请求失败 (${res.status})`;
        try {
          const errData = await res.json();
          errMsg = errData.detail || errData.message || errMsg;
        } catch { /* ignore parse error */ }
        setStatusMsg(<span><Badge variant="err">失败</Badge> {errMsg}</span>);
        return;
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errData = await res.json();
        setStatusMsg(<span><Badge variant="err">失败</Badge> {errData.message || errData.detail || '未知错误'}</span>);
        return;
      }

      const blob = await res.blob();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('content-disposition');
      const match = disposition?.match(/filename="?(.+?)"?$/);
      a.download = match?.[1] ?? '资产对比结果.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setStatusMsg(
        <div>
          <Badge variant="ok">导出成功</Badge> ZIP 文件已开始下载，包含对比总结 XLSX、PDF 及原始数据。
        </div>
      );
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">失败</Badge> {getErrorMessage(err)}</span>);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportSingle = async (key: string, label: string) => {
    setIsProcessing(true);
    setStatusMsg(<span>正在单独导出 {label} 模块...</span>);
    try {
      const res = await api.post(`/tools/asset/export/${key}`, { ...paths, remarks, reviews });
      if (res.data.status === 'error') {
        setStatusMsg(<span><Badge variant="err">失败</Badge> {res.data.message}</span>);
      } else {
        setStatusMsg(
          <div className="whitespace-pre-line">
            <Badge variant="ok">导出成功</Badge><br/>
            {res.data.message.replace(/.*成功:\n/, '')}
          </div>
        );
      }
    } catch (err: unknown) {
      setStatusMsg(<span><Badge variant="err">失败</Badge> {getErrorMessage(err)}</span>);
    } finally {
      setIsProcessing(false);
    }
  };

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
            disabled={isProcessing}
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
            placeholder="输入或粘贴文件夹路径..."
            className="flex-1 min-w-[240px] border-b border-border bg-transparent px-2 py-2 font-mono text-sm outline-none transition-colors focus:border-primary text-foreground placeholder:text-muted-foreground/60"
          />
          <button
            onClick={handleScanFolder}
            disabled={isProcessing || (!folderPath.trim() && selectedFilesRef.current.length === 0)}
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
          <UnboxedFileInput label="本期财务数据" value={paths.thisFinance} onChange={(val) => handlePathChange('thisFinance', val)} />
          <UnboxedFileInput label="上期财务数据" value={paths.lastFinance} onChange={(val) => handlePathChange('lastFinance', val)} />
          <ModuleProgressBar label="财务上传" progress={moduleProgress.finance} />
        </div>

        {/* SFC */}
        <div className="gsap-reveal bg-card p-6 border border-border transition-colors transition-shadow hover:border-primary/30 hover:shadow-[0_2px_16px_rgba(var(--primary-rgb),0.06)]">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">SFC (System)</h2>
          <UnboxedFileInput label="本期SFC数据" value={paths.thisSFC} onChange={(val) => handlePathChange('thisSFC', val)} />
          <UnboxedFileInput label="上期SFC数据" value={paths.lastSFC} onChange={(val) => handlePathChange('lastSFC', val)} />
          <ModuleProgressBar label="SFC上传" progress={moduleProgress.sfc} />
        </div>

        {/* Notes */}
        <div className="gsap-reveal bg-card p-6 border border-border transition-colors transition-shadow hover:border-primary/30 hover:shadow-[0_2px_16px_rgba(var(--primary-rgb),0.06)]">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">Notes (IT)</h2>
          <UnboxedFileInput label="本期Notes数据" value={paths.thisNotes} onChange={(val) => handlePathChange('thisNotes', val)} />
          <UnboxedFileInput label="上期Notes数据" value={paths.lastNotes} onChange={(val) => handlePathChange('lastNotes', val)} />
          <ModuleProgressBar label="Notes上传" progress={moduleProgress.notes} />
        </div>

        {/* Customer */}
        <div className="gsap-reveal bg-card p-6 border border-border transition-colors transition-shadow hover:border-primary/30 hover:shadow-[0_2px_16px_rgba(var(--primary-rgb),0.06)]">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">客户 (Customer)</h2>
          <UnboxedFileInput label="本期客户数据" value={paths.thisCustomer} onChange={(val) => handlePathChange('thisCustomer', val)} />
          <UnboxedFileInput label="上期客户数据" value={paths.lastCustomer} onChange={(val) => handlePathChange('lastCustomer', val)} />
          <ModuleProgressBar label="客户上传" progress={moduleProgress.customer} />
        </div>

        {/* Config / TXT */}
        <div className="gsap-reveal bg-card p-6 border border-border lg:col-span-2 transition-colors transition-shadow hover:border-primary/30 hover:shadow-[0_2px_16px_rgba(var(--primary-rgb),0.06)]">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">配置项 (Config TXT)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8">
            <UnboxedFileInput label="保管部门配置" value={paths.departmentData} onChange={(val) => handlePathChange('departmentData', val)} />
            <UnboxedFileInput label="保管人配置" value={paths.custodianData} onChange={(val) => handlePathChange('custodianData', val)} />
            <UnboxedFileInput label="客户DRI配置" value={paths.driData} onChange={(val) => handlePathChange('driData', val)} />
          </div>
        </div>

      </div>

      <div className="pt-8 flex flex-col sm:flex-row gap-6 max-w-6xl justify-start gsap-reveal border-b-2 border-border pb-8 mb-8">
        <button
          onClick={handleCheck}
          disabled={isProcessing}
          className="flex items-center justify-center gap-3 border-2 border-border px-10 py-4 text-lg font-bold uppercase tracking-tighter text-foreground transition-[background-color,color,transform] hover:bg-foreground hover:text-background active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckSquareOffset weight="bold" className="size-6" />
          开始核对
        </button>
        {statusMsg && (
          <div className="flex-1 p-4 bg-primary/10 text-primary font-mono text-sm max-w-2xl flex flex-col gap-2">
            <div>{statusMsg}</div>
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
              <div key={res.key} className={`p-6 border-2 ${res.has_diff ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
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
                    <p className={`font-mono mt-1 ${res.has_diff ? 'text-primary' : 'text-muted-foreground'}`}>{res.msg}</p>
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
                    onClick={() => handleExportSingle(res.key, res.label.replace(/【|】/g, ''))}
                    disabled={isProcessing}
                    className="p-2 border border-border hover:bg-foreground hover:text-background transition-colors flex-shrink-0 ml-4"
                    title={`单独导出${res.label.replace(/【|】/g, '')}结果`}
                  >
                    <DownloadSimple className="size-5" />
                  </button>
                </div>

                {res.has_diff && (
                  <div className="mt-4">
                    <label className="text-xs uppercase tracking-widest text-primary mb-2 block font-mono">请填写异常原因 (必填):</label>
                    <textarea
                      value={remarks[res.key] || ''}
                      onChange={(e) => handleRemarkChange(res.key, e.target.value)}
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
              disabled={isProcessing}
              className="flex items-center justify-center gap-3 bg-primary px-12 py-4 text-xl font-bold uppercase tracking-tighter text-primary-foreground transition-[background-color,transform] hover:bg-primary/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FloppyDisk weight="bold" className="size-6" />
              一键汇出 (Excel + PDF)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetComparison;
