import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/axios';
import { gsap } from 'gsap';

const StringAnalyzer: React.FC = () => {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
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

  const handleAction = async (action: string) => {
    if (!input.trim()) {
      setError('需要提供输入数据');
      return;
    }
    
    setError('');
    setLoading(true);
    setResult(null);

    try {
      const res = await api.post('/tools/string/process', { text: input, action });
      setResult({ action, data: res.data.result });
      
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTimeout(() => {
          gsap.fromTo('.result-box',
            { opacity: 0, x: -20 },
            { opacity: 1, x: 0, duration: 0.6, ease: 'expo.out' }
          );
        }, 50);
      }

    } catch (err: any) {
      setError(err.response?.data?.detail?.toUpperCase() || '系统发生错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="flex w-full flex-col pb-20">
      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-16 xl:gap-24 relative z-10">
        
        {/* 左侧输入与操作 */}
        <div className="gsap-reveal flex flex-col">
          <div className="relative group mb-12">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="awwwards-input w-full h-40 resize-none font-mono text-xl leading-relaxed text-foreground selection:bg-primary selection:text-primary-foreground"
              placeholder=" "
              spellCheck={false}
              id="payload"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'payload-error' : undefined}
            />
            <label htmlFor="payload" className="pointer-events-none absolute left-0 top-4 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground transition-[color,transform] duration-300 group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8">
              原始数据 (Payload)
            </label>
            {error && (
              <div id="payload-error" role="alert" className="absolute -bottom-8 left-0 font-mono text-[0.6875rem] uppercase tracking-widest text-primary">
                [ 异常: {error} ]
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">执行指令</p>
            {[
              { id: 'analyze', label: '分析数据' },
              { id: 'encode_base64', label: 'BASE64 编码' },
              { id: 'decode_base64', label: 'BASE64 解码' },
            ].map((act) => (
              <button
                key={act.id}
                onClick={() => handleAction(act.id)}
                disabled={loading}
                className="text-2xl md:text-4xl font-bold uppercase tracking-tighter hover:text-primary transition-colors text-left group flex items-center gap-4 disabled:opacity-50"
              >
                <span className="w-5 shrink-0 text-primary opacity-40 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.85,0,0.15,1)] group-hover:translate-x-1 group-hover:opacity-100 group-focus-visible:translate-x-1 group-focus-visible:opacity-100">→</span>
                {act.label}
              </button>
            ))}
          </div>
        </div>

        {/* 右侧输出 */}
        <div className="gsap-reveal flex flex-col pt-4 lg:pt-0">
          <p className="mb-6 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">输出流 (Output Stream)</p>
          
          <div className="flex-1 min-h-[300px] border-l-2 border-border pl-8 md:pl-12">
            {loading ? (
              <div role="status" className="text-3xl font-bold tracking-tighter uppercase text-muted-foreground animate-pulse">
                处理中...
              </div>
            ) : result ? (
              <div className="result-box text-xl md:text-2xl font-mono text-foreground break-all leading-relaxed selection:bg-primary selection:text-primary-foreground">
                {result.action === 'analyze' ? (
                  <div className="flex flex-col gap-8">
                    <div>
                      <span className="mb-2 block text-[0.625rem] tracking-[0.2em] text-muted-foreground">字符数</span>
                      <span className="text-5xl md:text-7xl font-bold tracking-tighter text-primary">{result.data.length}</span>
                    </div>
                    <div className="flex gap-16">
                      <div>
                        <span className="mb-2 block text-[0.625rem] tracking-[0.2em] text-muted-foreground">词数</span>
                        <span className="text-3xl md:text-4xl font-bold tracking-tighter">{result.data.words}</span>
                      </div>
                      <div>
                        <span className="mb-2 block text-[0.625rem] tracking-[0.2em] text-muted-foreground">行数</span>
                        <span className="text-3xl md:text-4xl font-bold tracking-tighter">{result.data.lines}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>{result.data}</div>
                )}
              </div>
            ) : (
              <div className="text-3xl font-bold tracking-tighter uppercase text-border">
                等待<br/>指令输入
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default StringAnalyzer;
