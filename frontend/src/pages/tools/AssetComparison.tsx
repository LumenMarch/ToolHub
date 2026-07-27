import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { FileArrowUp, CheckSquareOffset, FloppyDisk, MagicWand, DownloadSimple } from '@phosphor-icons/react';
import axios from 'axios';

const UnboxedFileInput: React.FC<{ label: string, value: string, onChange: (val: string) => void }> = ({ label, value, onChange }) => {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <div className="relative group w-full mb-8">
      <div className={`absolute left-0 transition-all duration-300 ease-out font-mono uppercase tracking-[0.1em] pointer-events-none text-muted-foreground ${isFocused || value ? '-top-5 text-[10px] text-primary' : 'top-2 text-sm'}`}>
        {label}
      </div>
      <div className="flex items-center border-b border-border group-focus-within:border-primary transition-colors">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="w-full bg-transparent border-none outline-none py-1.5 text-base md:text-lg font-medium tracking-wide text-foreground truncate"
          placeholder=""
        />
        <button 
          className="p-1.5 text-muted-foreground hover:text-primary transition-colors active:scale-95 flex-shrink-0"
          title="选择文件"
        >
          <FileArrowUp weight="bold" className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

interface CheckResult {
  key: string;
  label: string;
  has_diff: boolean;
  msg: string;
}

const REVIEW_OPTIONS = ["差異確認OK", "待跟进", "異常"];

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
    const ctx = gsap.context(() => {
      gsap.to('.clip-text > span', {
        y: 0,
        duration: 1.2,
        stagger: 0.1,
        ease: 'power4.out',
      });
      gsap.from('.gsap-reveal', {
        y: 20,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'expo.out',
        delay: 0.4
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const handleAutoFill = async () => {
    setStatusMsg('正在扫描桌面文件...');
    setIsProcessing(true);
    try {
      const res = await axios.get('http://localhost:8000/api/v1/tools/asset/auto-paths');
      if (res.data.status === 'success') {
        setPaths(res.data.data);
        setStatusMsg('✅ 一键注入完成：已自动匹配桌面 /对比数据 目录下的文件。');
      } else {
        setStatusMsg(`注入失败: ${res.data.message}`);
      }
    } catch (err: any) {
      setStatusMsg(`请求失败: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCheck = async () => {
    setIsProcessing(true);
    setStatusMsg('正在核对数据，请稍候...');
    setCheckResults([]);
    // Init reviews with default option
    setReviews({});
    try {
      const res = await axios.post('http://localhost:8000/api/v1/tools/asset/check', { ...paths, remarks, reviews });
      
      if (res.data.status === 'error') {
        setStatusMsg(`❌ 错误: ${res.data.message} \n ${res.data.errors?.join(' | ') || ''}`);
      } else {
        const resData: CheckResult[] = res.data.data.results || [];
        setCheckResults(resData);
        // Pre-fill review drop-downs
        const newReviews: Record<string, string> = {};
        resData.forEach(r => newReviews[r.key] = REVIEW_OPTIONS[0]);
        setReviews(newReviews);

        setStatusMsg(
          <div className="font-bold text-green-500">
            ✅ 核对完成! 请在下方填写有差异项的异常原因并选择审核状态。
          </div>
        );
      }
    } catch (err: any) {
      setStatusMsg(`❌ 请求失败: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveAll = async () => {
    // Validation
    const missingRemarks = checkResults.filter(r => r.has_diff && !remarks[r.key]?.trim());
    if (missingRemarks.length > 0) {
      alert(`请先填写以下有差异模块的异常原因：\n${missingRemarks.map(r => r.label.replace(/【|】/g, '')).join(', ')}`);
      return;
    }

    setIsProcessing(true);
    setStatusMsg('正在生成完整对比总结及PDF...');
    try {
      const res = await axios.post('http://localhost:8000/api/v1/tools/asset/save', { ...paths, remarks, reviews });
      if (res.data.status === 'error') {
        setStatusMsg(`❌ 保存失败: ${res.data.message}`);
      } else {
        setStatusMsg(
          <div className="whitespace-pre-line">
            <span className="font-bold">✅ 导出成功:</span><br/>
            {res.data.message.replace(/.*成功:\n/, '')}
          </div>
        );
      }
    } catch (err: any) {
      setStatusMsg(`❌ 保存失败: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportSingle = async (key: string, label: string) => {
    setIsProcessing(true);
    setStatusMsg(`正在单独导出 ${label} 模块...`);
    try {
      // Re-trigger the specific export from python backend
      const res = await axios.post(`http://localhost:8000/api/v1/tools/asset/export/${key}`, { ...paths, remarks, reviews });
      if (res.data.status === 'error') {
        setStatusMsg(`❌ 单独导出失败: ${res.data.message}`);
      } else {
        setStatusMsg(
          <div className="whitespace-pre-line">
            <span className="font-bold">✅ {label}单独导出成功:</span><br/>
            {res.data.message.replace(/.*成功:\n/, '')}
          </div>
        );
      }
    } catch (err: any) {
      setStatusMsg(`❌ 单独导出失败: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div ref={containerRef} className="w-full flex flex-col justify-center min-h-[70vh] py-10">
      <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[0.85] uppercase">
            <div className="clip-text"><span>资产核对</span></div>
          </h1>
          <p className="mt-6 text-muted-foreground font-mono uppercase tracking-[0.2em] text-sm gsap-reveal">
            [ ASSET COMPARISON V1.2.7 INTERFACE ]
          </p>
        </div>
        
        <div className="gsap-reveal">
          <button 
            onClick={handleAutoFill}
            disabled={isProcessing}
            className="py-3 px-6 bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-all active:scale-[0.98] font-bold uppercase tracking-tight flex items-center justify-center gap-2 border border-border"
          >
            <MagicWand weight="bold" className="w-5 h-5 text-primary" />
            一键注入路径
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
          className="py-4 px-10 border-2 border-border text-foreground hover:bg-foreground hover:text-background transition-all active:scale-[0.98] disabled:opacity-50 font-bold text-lg uppercase tracking-tighter flex items-center justify-center gap-3"
        >
          <CheckSquareOffset weight="bold" className="w-6 h-6" />
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
            <div className="w-4 h-4 bg-primary rounded-full"></div>
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
                        className="bg-background border border-border px-3 py-1 font-mono text-sm outline-none cursor-pointer focus:border-primary"
                      >
                        {REVIEW_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                    <p className={`font-mono mt-1 ${res.has_diff ? 'text-primary' : 'text-muted-foreground'}`}>{res.msg}</p>
                  </div>
                  <button 
                    onClick={() => handleExportSingle(res.key, res.label.replace(/【|】/g, ''))}
                    disabled={isProcessing}
                    className="p-2 border border-border hover:bg-foreground hover:text-background transition-colors flex-shrink-0 ml-4"
                    title={`单独导出${res.label.replace(/【|】/g, '')}结果`}
                  >
                    <DownloadSimple className="w-5 h-5" />
                  </button>
                </div>
                
                {res.has_diff && (
                  <div className="mt-4">
                    <label className="text-xs uppercase tracking-widest text-primary mb-2 block font-mono">请填写异常原因 (必填):</label>
                    <textarea 
                      value={remarks[res.key] || ''}
                      onChange={(e) => handleRemarkChange(res.key, e.target.value)}
                      className="w-full bg-background border border-border p-3 outline-none focus:border-primary transition-colors resize-none font-mono text-sm"
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
              className="py-4 px-12 bg-primary text-primary-foreground hover:bg-primary/90 transition-all active:scale-[0.98] disabled:opacity-50 font-bold text-xl uppercase tracking-tighter flex items-center justify-center gap-3"
            >
              <FloppyDisk weight="bold" className="w-6 h-6" />
              一键汇出 (Excel + PDF)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetComparison;
