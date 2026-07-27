import React, { useState, useEffect, useRef } from 'react';
import { Copy, ArrowsClockwise } from '@phosphor-icons/react';
import { gsap } from 'gsap';

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

  const generatePassword = () => {
    let charset = "abcdefghijklmnopqrstuvwxyz";
    if (includeUppercase) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (includeNumbers) charset += "0123456789";
    if (includeSymbols) charset += "!@#$%^&*()_+~`|}{[]:;?><,./-=";

    let newPassword = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
      newPassword += charset.charAt(Math.floor(Math.random() * n));
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
    <div ref={containerRef} className="w-full flex flex-col justify-center min-h-[70vh]">
      <div className="mb-16 ">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[0.85] uppercase">
          <div className="clip-text"><span>安全密钥</span></div><br/>
          <div className="clip-text"><span className="text-primary">生成器.</span></div>
        </h1>
      </div>

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
            {copied ? <span role="status" className="font-mono text-xs uppercase tracking-widest text-primary">已复制</span> : <Copy weight="bold" className="w-8 h-8" />}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 gsap-reveal">
          {/* 密钥控制项 */}
          <div className="space-y-12">
            <div>
              <div className="flex justify-between items-end mb-6">
                <label className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground">长度 (Length)</label>
                <span className="text-xl font-bold font-mono text-primary">{length}</span>
              </div>
              <input
                type="range"
                min="8"
                max="64"
                value={length}
                onChange={(e) => setLength(Number(e.target.value))}
                aria-label="密钥长度"
                className="w-full h-[2px] bg-border rounded-none appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-none active:[&::-webkit-slider-thumb]:scale-75 transition-all"
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
                    <div className="absolute top-0 left-0 w-1/2 h-full bg-border peer-checked:bg-primary peer-checked:translate-x-full transition-all duration-300 ease-out"></div>
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
              <ArrowsClockwise weight="bold" className="w-10 h-10 group-hover:rotate-180 transition-transform duration-700 ease-out" />
              重新生成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PwdGenerator;
