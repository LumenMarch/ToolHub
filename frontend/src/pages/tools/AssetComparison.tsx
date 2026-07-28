import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { FileArrowUp, CheckSquareOffset, FloppyDisk, DownloadSimple, Plus, Minus, Warning, FolderOpen } from '@phosphor-icons/react';
import api from '../../api/axios';

const UnboxedFileInput: React.FC<{ label: string, value: string, onChange: (val: string) => void; displayValue?: string }> = ({ label, value, onChange, displayValue }) => {
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

const REVIEW_OPTIONS = ["差異確認OK", "待跟进", "異常"];

// 状态徽章小组件，替代 emoji
const Badge: React.FC<{ variant: 'ok' | 'warn' | 'err' | 'info'; children: React.ReactNode }> = ({ variant, children }) => {
  const colors: Record<string, string> = {
    ok: 'text-green-600 bg-green-50 border-green-300',
    warn: 'text-amber-600 bg-amber-50 border-amber-300',
    err: 'text-red-600 bg-red-50 border-red-300',
    info: 'text-blue-600 bg-blue-50 border-blue-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[0.65rem] font-mono font-bold uppercase tracking-wider ${colors[variant]}`}>
      {children}
    </span>
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
  // 用普通数组存储文件，避免 FileList 引用随 input 重置而失效
  const selectedFilesRef = useRef<File[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [checkResults, setCheckResults] = useState<CheckResult[]>([]);
  const [statusMsg, setStatusMsg] = useState<React.ReactNode>('');
  const [isProcessing, setIsProcessing] = useState(false);

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

  // 触发系统原生文件夹选择器
  const handleSelectFolder = () => {
    folderInputRef.current?.click();
  };

  // 文件夹选择后：克隆文件数组并显示摘要
  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // 关键修复：用 Array.from 复制一份，避免 FileList 引用在 input reset 后失效
    selectedFilesRef.current = Array.from(files);
    const firstPath = files[0].webkitRelativePath;
    const folderName = firstPath.split('/')[0];
    setFolderPath(folderName);
    setStatusMsg(
      <div className="text-xs leading-relaxed">
        <Badge variant="info">已选择</Badge> 文件夹 <span className="font-bold">{folderName}</span>，共 {files.length} 个文件。点击「扫描解析」上传并匹配。
      </div>
    );
    e.target.value = '';
  };

  // 扫描匹配：优先上传已选文件到服务器临时目录；否则用文本路径
  const handleScanFolder = async () => {
    const fileArr = selectedFilesRef.current;

    if (fileArr.length > 0) {
      // 上传模式：把文件发到服务器临时目录再匹配
      setIsProcessing(true);
      setStatusMsg(<span>正在上传 {fileArr.length} 个文件到服务器并解析...</span>);
      try {
        const formData = new FormData();
        for (const f of fileArr) {
          formData.append('files', f);
        }
        const res = await api.post('/tools/asset/upload-and-scan', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000,  // 120秒超时，大文件 + 局域网传输可能较慢
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
            setPaths(data);
            setStatusMsg(
              <span>
                <Badge variant="warn">警告</Badge> 未匹配到任何数据表，请确认文件名包含正确关键词和年月。
              </span>
            );
          }
        } else {
          setStatusMsg(<span><Badge variant="err">失败</Badge> {res.data.message}</span>);
        }
      } catch (err: any) {
        const detail = err.response?.data?.message || err.response?.data?.detail || err.response?.statusText || err.message;
        const status = err.response?.status ? ` [HTTP ${err.response.status}]` : '';
        setStatusMsg(<span><Badge variant="err">错误{status}</Badge> {detail}</span>);
      } finally {
        setIsProcessing(false);
        selectedFilesRef.current = [];
      }
      return;
    }

    // 文本路径模式：服务器本地扫描
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
    } catch (err: any) {
      setStatusMsg(<span><Badge variant="err">错误</Badge> 请求: {err.message}</span>);
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
    } catch (err: any) {
      setStatusMsg(<span><Badge variant="err">错误</Badge> 请求: {err.message}</span>);
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
    setStatusMsg('正在生成完整对比总结及PDF...');
    try {
      const res = await api.post('/tools/asset/save', { ...paths, remarks, reviews });
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
    } catch (err: any) {
      setStatusMsg(<span><Badge variant="err">失败</Badge> {err.message}</span>);
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
    } catch (err: any) {
      setStatusMsg(<span><Badge variant="err">失败</Badge> {err.message}</span>);
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

        {/* 隐藏的原生文件夹选择器 */}
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
        <div className="gsap-reveal bg-card p-6 border border-border">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">财务 (Finance)</h2>
          <UnboxedFileInput label="本期财务数据" value={paths.thisFinance} onChange={(val) => handlePathChange('thisFinance', val)} />
          <UnboxedFileInput label="上期财务数据" value={paths.lastFinance} onChange={(val) => handlePathChange('lastFinance', val)} />
        </div>

        {/* SFC */}
        <div className="gsap-reveal bg-card p-6 border border-border">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">SFC (System)</h2>
          <UnboxedFileInput label="本期SFC数据" value={paths.thisSFC} onChange={(val) => handlePathChange('thisSFC', val)} />
          <UnboxedFileInput label="上期SFC数据" value={paths.lastSFC} onChange={(val) => handlePathChange('lastSFC', val)} />
        </div>

        {/* Notes */}
        <div className="gsap-reveal bg-card p-6 border border-border">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">Notes (IT)</h2>
          <UnboxedFileInput label="本期Notes数据" value={paths.thisNotes} onChange={(val) => handlePathChange('thisNotes', val)} />
          <UnboxedFileInput label="上期Notes数据" value={paths.lastNotes} onChange={(val) => handlePathChange('lastNotes', val)} />
        </div>

        {/* Customer */}
        <div className="gsap-reveal bg-card p-6 border border-border">
          <h2 className="text-xl font-bold uppercase tracking-tight mb-8 text-primary">客户 (Customer)</h2>
          <UnboxedFileInput label="本期客户数据" value={paths.thisCustomer} onChange={(val) => handlePathChange('thisCustomer', val)} />
          <UnboxedFileInput label="上期客户数据" value={paths.lastCustomer} onChange={(val) => handlePathChange('lastCustomer', val)} />
        </div>

        {/* Config / TXT */}
        <div className="gsap-reveal bg-card p-6 border border-border lg:col-span-2">
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
          <div className="flex-1 p-4 bg-primary/10 text-primary font-mono text-sm max-w-2xl flex items-center">
            {statusMsg}
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
                    {/* 财务-财务：按保管人/部门分组展示本月新增、减少、异常 */}
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
