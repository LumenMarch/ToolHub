import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Copy, ArrowsClockwise, ShieldCheck } from '@phosphor-icons/react';
import { gsap } from 'gsap';
import { checkPasswordStrength } from './strength';

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
  const [checkInput, setCheckInput] = useState('');
  
  const pwdDisplayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const generatedStrength = useMemo(() => checkPasswordStrength(password), [password]);
  const checkResult = useMemo(() => checkPasswordStrength(checkInput), [checkInput]);

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
    <div ref={containerRef} className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto">
      <div className="w-full relative z-10">
        {/* 大尺寸密钥展示 */}
        <div className="relative mb-16 group gsap-reveal">
          <div 
            ref={pwdDisplayRef}
            className="w-full bg-transparent border-b-2 border-border pb-4 pr-16 break-all font-mono text-4xl md:text-6xl lg:text-7xl tracking-widest text-foreground selection:bg-primary selection:text-primary-foreground"
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 gsap-reveal">
          {/* 长度 */}
          <div className="min-w-0">
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
          </div>

          {/* 字符集开关 + 重新生成 */}
          <div className="flex min-w-0 flex-col gap-10">
            <div className="flex flex-col gap-6">
              {[
                { label: '大写字母 (A-Z)', state: includeUppercase, set: setIncludeUppercase },
                { label: '数字 (0-9)', state: includeNumbers, set: setIncludeNumbers },
                { label: '特殊符号 (!@#)', state: includeSymbols, set: setIncludeSymbols },
              ].map((opt) => (
                <label key={opt.label} className="flex items-center justify-between cursor-pointer group">
                  <span className="text-xl font-medium tracking-tight uppercase group-hover:text-primary transition-colors">{opt.label}</span>
                  <div className="relative w-12 h-6 bg-muted overflow-hidden border border-border shrink-0">
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
            <button
              onClick={generatePassword}
              className="text-2xl lg:text-3xl xl:text-5xl font-bold uppercase tracking-tighter hover:text-primary transition-colors active:scale-95 flex items-center gap-3 lg:gap-4 group self-start"
            >
              <ArrowsClockwise weight="bold" className="size-8 lg:size-9 xl:size-12 transition-transform duration-700 ease-out group-hover:rotate-180" />
              重新生成
            </button>
          </div>

          {/* 生成结果强度摘要 */}
          <div className="min-w-0">
            <p className="mb-6 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">生成结果 (Generated)</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-8">
              <div className="min-w-0 border-t border-border pt-4">
                <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">强度</span>
                <span className="mt-2 block min-w-0 text-2xl md:text-3xl font-bold tracking-tighter break-words text-primary">{generatedStrength.strength}</span>
              </div>
              <div className="min-w-0 border-t border-border pt-4">
                <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">评分</span>
                <span className="mt-2 block min-w-0 text-2xl md:text-3xl font-bold tracking-tighter break-words">
                  {generatedStrength.score}
                  <span className="text-lg text-muted-foreground">/100</span>
                </span>
              </div>
              <div className="min-w-0 border-t border-border pt-4">
                <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">熵值</span>
                <span className="mt-2 block min-w-0 text-2xl md:text-3xl font-bold tracking-tighter break-words">
                  {generatedStrength.entropy}
                  <span className="text-lg text-muted-foreground"> bits</span>
                </span>
              </div>
              <div className="min-w-0 border-t border-border pt-4">
                <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">破解时间</span>
                <span className="mt-2 block min-w-0 text-2xl md:text-3xl font-bold tracking-tighter break-words">{generatedStrength.time_to_crack}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 强度检测 */}
        <section className="mt-24 border-t-2 border-border pt-12 gsap-reveal" aria-labelledby="strength-check-title">
          <div className="mb-10 flex items-center gap-5">
            <ShieldCheck weight="bold" className="size-8 shrink-0 text-primary" />
            <div>
              <h2 id="strength-check-title" className="text-2xl md:text-3xl font-bold tracking-tight">
                强度检测
              </h2>
              <p className="mt-1 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                STRENGTH CHECK · 纯本地计算
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-12 xl:gap-20">
            <div>
              <div className="relative group">
                <input
                  type="text"
                  value={checkInput}
                  onChange={(e) => setCheckInput(e.target.value)}
                  className="awwwards-input w-full font-mono text-xl leading-relaxed text-foreground selection:bg-primary selection:text-primary-foreground"
                  placeholder=" "
                  spellCheck={false}
                  autoComplete="off"
                  id="strength-password"
                />
                <label htmlFor="strength-password" className="pointer-events-none absolute left-0 top-4 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground transition-[color,transform] duration-300 group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8">
                  待检测密码 (Password)
                </label>
              </div>
              <p className="mt-5 font-mono text-xs leading-relaxed text-muted-foreground">
                输入任意密码，实时检测强度。密码仅在本机计算，不会发送到服务器。
              </p>
            </div>

            <div className="min-w-0">
              {checkInput ? (
                <div className="flex flex-col gap-8">
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-6">
                    <div className="min-w-0 border-t border-border pt-4">
                      <span className="block font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">强度</span>
                      <span className="mt-2 block text-2xl md:text-3xl font-bold tracking-tighter break-words text-primary">{checkResult.strength}</span>
                    </div>
                    <div className="min-w-0 border-t border-border pt-4">
                      <span className="block font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">评分</span>
                      <span className="mt-2 block text-2xl md:text-3xl font-bold tracking-tighter break-words">
                        {checkResult.score}
                        <span className="text-base md:text-lg text-muted-foreground">/100</span>
                      </span>
                    </div>
                    <div className="min-w-0 border-t border-border pt-4">
                      <span className="block font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">熵值</span>
                      <span className="mt-2 block text-2xl md:text-3xl font-bold tracking-tighter break-words">
                        {checkResult.entropy}
                        <span className="text-base md:text-lg text-muted-foreground"> bits</span>
                      </span>
                    </div>
                    <div className="min-w-0 border-t border-border pt-4">
                      <span className="block font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">破解时间</span>
                      <span className="mt-2 block text-2xl md:text-3xl font-bold tracking-tighter break-words">{checkResult.time_to_crack}</span>
                    </div>
                  </div>

                  <div className="h-1.5 w-full bg-border" role="meter" aria-label="密码强度评分" aria-valuenow={checkResult.score} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${checkResult.score}%` }} />
                  </div>

                  <div>
                    <p className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">字符分析</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-2 font-mono text-xs">
                      {[
                        { label: '小写字母', present: checkResult.character_analysis.has_lowercase },
                        { label: '大写字母', present: checkResult.character_analysis.has_uppercase },
                        { label: '数字', present: checkResult.character_analysis.has_numbers },
                        { label: '特殊符号', present: checkResult.character_analysis.has_symbols },
                        { label: '重复字符', present: checkResult.character_analysis.has_repeated },
                        { label: '连续字符', present: checkResult.character_analysis.has_sequential },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5">
                          <span className="text-muted-foreground">{item.label}</span>
                          <span className={item.present ? 'text-status-danger-foreground' : 'text-status-success-foreground'}>
                            {item.present ? '有' : '无'}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5">
                        <span className="text-muted-foreground">字符多样性</span>
                        <span className="text-foreground">{checkResult.character_analysis.character_variety}</span>
                      </div>
                    </div>
                  </div>

                  {checkResult.recommendations.length > 0 && (
                    <div>
                      <p className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">改进建议</p>
                      <ul className="flex flex-col gap-2.5">
                        {checkResult.recommendations.map((recommendation) => (
                          <li key={recommendation} className="flex gap-3 text-sm leading-relaxed">
                            <span aria-hidden="true" className="shrink-0 text-primary">→</span>
                            {recommendation}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <p className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">安全提示</p>
                    <ul className="flex flex-col gap-2.5">
                      {checkResult.security_tips.slice(0, 5).map((tip) => (
                        <li key={tip} className="flex gap-3 text-xs leading-relaxed text-muted-foreground">
                          <span aria-hidden="true" className="shrink-0 text-primary">→</span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="text-3xl font-bold tracking-tighter uppercase text-border">
                  等待<br/>输入密码
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default PwdGenerator;
