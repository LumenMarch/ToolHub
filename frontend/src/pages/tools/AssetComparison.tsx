import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { FileArrowUp, CheckSquareOffset, FloppyDisk } from '@phosphor-icons/react';

const UnboxedFileInput: React.FC<{ label: string, value: string, onChange: (val: string) => void }> = ({ label, value, onChange }) => {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <div className="relative group w-full mb-10">
      <div className={`absolute left-0 transition-all duration-300 ease-out font-mono uppercase tracking-[0.15em] pointer-events-none text-muted-foreground ${isFocused || value ? '-top-5 text-[10px] text-primary' : 'top-2 text-sm'}`}>
        {label}
      </div>
      <div className="flex items-center border-b-2 border-border group-focus-within:border-primary transition-colors">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="w-full bg-transparent border-none outline-none py-2 text-lg md:text-xl font-medium tracking-wide text-foreground"
          placeholder=""
        />
        <button 
          className="p-2 text-muted-foreground hover:text-primary transition-colors active:scale-95"
          title="选择文件"
        >
          <FileArrowUp weight="bold" className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};

const AssetComparison: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const [allDataPath, setAllDataPath] = useState('');
  const [thisFinance, setThisFinance] = useState('');
  const [lastFinance, setLastFinance] = useState('');
  const [departmentData, setDepartmentData] = useState('');
  const [custodianData, setCustodianData] = useState('');

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

  return (
    <div ref={containerRef} className="w-full flex flex-col justify-center min-h-[70vh] py-10">
      <div className="mb-16">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[0.85] uppercase">
          <div className="clip-text"><span>资产核对</span></div><br/>
          <div className="clip-text"><span className="text-primary">系统.</span></div>
        </h1>
        <p className="mt-6 text-muted-foreground font-mono uppercase tracking-[0.2em] text-sm gsap-reveal">
          [ ASSET COMPARISON V1.2.7 INTERFACE ]
        </p>
      </div>

      <div className="w-full max-w-5xl relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-x-16 gap-y-8">
        
        {/* Left Column: Finance Data */}
        <div className="gsap-reveal space-y-2">
          <h2 className="text-2xl font-bold uppercase tracking-tight mb-8">财务数据 (Finance)</h2>
          <UnboxedFileInput label="总台账数据文件 (All Data)" value={allDataPath} onChange={setAllDataPath} />
          <UnboxedFileInput label="本期财务数据 (This Finance)" value={thisFinance} onChange={setThisFinance} />
          <UnboxedFileInput label="上期财务数据 (Last Finance)" value={lastFinance} onChange={setLastFinance} />
        </div>

        {/* Right Column: Other Data & Actions */}
        <div className="gsap-reveal space-y-2">
          <h2 className="text-2xl font-bold uppercase tracking-tight mb-8">业务数据 (Operations)</h2>
          <UnboxedFileInput label="部门数据 (Department)" value={departmentData} onChange={setDepartmentData} />
          <UnboxedFileInput label="保管人数据 (Custodian)" value={custodianData} onChange={setCustodianData} />
          
          <div className="pt-12 flex flex-col sm:flex-row gap-6 lg:justify-end">
            <button className="flex-1 lg:flex-none py-4 px-8 border-2 border-border text-foreground hover:bg-foreground hover:text-background transition-all active:scale-[0.98] font-bold text-xl uppercase tracking-tighter flex items-center justify-center gap-3">
              <CheckSquareOffset weight="bold" className="w-6 h-6" />
              数据核对
            </button>
            <button className="flex-1 lg:flex-none py-4 px-8 bg-primary text-primary-foreground hover:bg-primary/90 transition-all active:scale-[0.98] font-bold text-xl uppercase tracking-tighter flex items-center justify-center gap-3">
              <FloppyDisk weight="bold" className="w-6 h-6" />
              保存结果
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssetComparison;
