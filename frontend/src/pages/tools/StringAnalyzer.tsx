import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/axios';
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
    <div ref={containerRef} className="w-full flex flex-col justify-center min-h-[70vh]">
      <div className="mb-16 ">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[0.85] uppercase">
          <div className="clip-text"><span>字符</span></div><br/>
          <div className="clip-text"><span className="text-primary">处理器.</span></div>
        </h1>
      </div>

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
            <label htmlFor="payload" className="absolute left-0 top-4 text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase transition-all duration-300 pointer-events-none group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8">
              原始数据 (Payload)
            </label>
            {error && (
              <div id="payload-error" role="alert" className="absolute -bottom-8 left-0 text-[11px] font-mono tracking-widest text-primary uppercase">
                [ 异常: {error} ]
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <p className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground mb-2 uppercase">执行指令</p>
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
                <span className="w-0 overflow-hidden group-hover:w-8 transition-all duration-500 ease-[cubic-bezier(0.85,0,0.15,1)] opacity-0 group-hover:opacity-100 text-primary">→</span>
                {act.label}
              </button>
            ))}
          </div>
        </div>

        {/* 右侧输出 */}
        <div className="gsap-reveal flex flex-col pt-4 lg:pt-0">
          <p className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground mb-6 uppercase">输出流 (Output Stream)</p>
          
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
                      <span className="block text-[10px] tracking-[0.2em] text-muted-foreground mb-2">字符数</span>
                      <span className="text-5xl md:text-7xl font-bold tracking-tighter text-primary">{result.data.length}</span>
                    </div>
                    <div className="flex gap-16">
                      <div>
                        <span className="block text-[10px] tracking-[0.2em] text-muted-foreground mb-2">词数</span>
                        <span className="text-3xl md:text-4xl font-bold tracking-tighter">{result.data.words}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] tracking-[0.2em] text-muted-foreground mb-2">行数</span>
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
