import React, { useState, useEffect, useRef } from 'react';
import { Copy, ArrowsClockwise } from '@phosphor-icons/react';
import { gsap } from 'gsap';

const UINT32_RANGE = 0x1_0000_0000;

const secureRandomIndex = (upperBound: number) => {
  const rejectionLimit = UINT32_RANGE - (UINT32_RANGE % upperBound);
  const randomValue = new Uint32Array(1);

  do {
    crypto.getRandomValues(randomValue);
  } while (randomValue[0] >= rejectionLimit);

  return randomValue[0] % upperBound;
};

const PwdGenerator: React.FC = () => {
  const [password, setPassword] = useState('');
  const [length, setLength] = useState(16);
  const [includeUppercase, setIncludeUppercase] = useState(true);
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [includeSymbols, setIncludeSymbols] = useState(true);
  const [copied, setCopied] = useState(false);
  
  const pwdDisplayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const generatePassword = () => {
    let charset = "abcdefghijklmnopqrstuvwxyz";
    if (includeUppercase) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (includeNumbers) charset += "0123456789";
    if (includeSymbols) charset += "!@#$%^&*()_+~`|}{[]:;?><,./-=";

    let newPassword = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
      newPassword += charset.charAt(secureRandomIndex(n));
    }
    setPassword(newPassword);
    setCopied(false);

    if (
      pwdDisplayRef.current &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      gsap.fromTo(pwdDisplayRef.current, 
        { opacity: 0, y: 10 }, 
        { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }
      );
    }
  };

  useEffect(() => {
    generatePassword();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div ref={containerRef} className="flex w-full flex-col pb-20">
      <div className="w-full max-w-4xl relative z-10">
        {/* 大尺寸密钥展示 */}
        <div className="relative mb-16 group gsap-reveal">
          <div 
            ref={pwdDisplayRef}
            className="w-full bg-transparent border-b-2 border-border pb-4 pr-16 break-all font-mono text-3xl md:text-5xl lg:text-6xl tracking-widest text-foreground selection:bg-primary selection:text-primary-foreground"
          >
            {password}
          </div>
          <button
            onClick={handleCopy}
            aria-label={copied ? '密钥已复制' : '复制密钥到剪贴板'}
            className="absolute right-0 top-1/2 -translate-y-1/2 p-4 text-muted-foreground hover:text-primary transition-colors active:scale-90"
            title="复制到剪贴板"
          >
            {copied ? <span role="status" className="font-mono text-xs uppercase tracking-widest text-primary">已复制</span> : <Copy weight="bold" className="size-8" />}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 gsap-reveal">
          {/* 密钥控制项 */}
          <div className="space-y-12">
            <div>
              <div className="flex justify-between items-end mb-6">
                <label className="text-[0.6875rem] font-mono uppercase tracking-[0.2em] text-muted-foreground">长度 (Length)</label>
                <span className="text-xl font-bold font-mono text-primary">{length}</span>
              </div>
              <input
                type="range"
                min="8"
                max="64"
                value={length}
                onChange={(e) => setLength(Number(e.target.value))}
                aria-label="密钥长度"
                className="h-[2px] w-full cursor-pointer appearance-none rounded-none bg-border [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:bg-primary active:[&::-webkit-slider-thumb]:scale-75"
              />
            </div>

            <div className="flex flex-col gap-6">
              {[
                { label: '大写字母 (A-Z)', state: includeUppercase, set: setIncludeUppercase },
                { label: '数字 (0-9)', state: includeNumbers, set: setIncludeNumbers },
                { label: '特殊符号 (!@#)', state: includeSymbols, set: setIncludeSymbols },
              ].map((opt) => (
                <label key={opt.label} className="flex items-center justify-between cursor-pointer group">
                  <span className="text-xl font-medium tracking-tight uppercase group-hover:text-primary transition-colors">{opt.label}</span>
                  <div className="relative w-12 h-6 bg-muted overflow-hidden border border-border">
                    <input
                      type="checkbox"
                      checked={opt.state}
                      onChange={(e) => opt.set(e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="absolute left-0 top-0 h-full w-1/2 bg-border transition-[background-color,transform] duration-300 ease-out peer-checked:translate-x-full peer-checked:bg-primary"></div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-end justify-end">
            <button
              onClick={generatePassword}
              className="text-4xl md:text-5xl font-bold uppercase tracking-tighter hover:text-primary transition-colors active:scale-95 origin-right flex items-center gap-4 group"
            >
              <ArrowsClockwise weight="bold" className="size-10 transition-transform duration-700 ease-out group-hover:rotate-180" />
              重新生成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PwdGenerator;
