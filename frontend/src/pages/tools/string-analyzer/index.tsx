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
      setError(err.response?.data?.detail || '系统发生错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto">
      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-16 xl:gap-24 relative z-10">
        
        {/* 左侧输入与操作 */}
        <div className="gsap-reveal flex flex-col self-start lg:sticky lg:top-28">
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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-12 gap-y-12">
            {[
              {
                label: '基础指令',
                actions: [
                  { id: 'analyze', label: '分析数据' },
                  { id: 'encode_base64', label: 'BASE64 编码' },
                  { id: 'decode_base64', label: 'BASE64 解码' },
                ],
                size: 'text-2xl md:text-4xl',
              },
              {
                label: '哈希 (HASH)',
                actions: [
                  { id: 'hash_md5', label: 'MD5' },
                  { id: 'hash_sha1', label: 'SHA1' },
                  { id: 'hash_sha256', label: 'SHA256' },
                  { id: 'hash_sha512', label: 'SHA512' },
                ],
                size: 'text-lg md:text-2xl',
              },
              {
                label: 'URL 编码 (URL)',
                actions: [
                  { id: 'url_encode', label: 'URL 编码' },
                  { id: 'url_decode', label: 'URL 解码' },
                ],
                size: 'text-lg md:text-2xl',
              },
              {
                label: '压缩 (COMPRESS)',
                actions: [
                  { id: 'gzip_encode', label: 'GZIP 编码' },
                  { id: 'gzip_decode', label: 'GZIP 解码' },
                  { id: 'deflate_encode', label: 'DEFLATE 编码' },
                  { id: 'deflate_decode', label: 'DEFLATE 解码' },
                  { id: 'brotli_encode', label: 'BROTLI 编码' },
                  { id: 'brotli_decode', label: 'BROTLI 解码' },
                ],
                size: 'text-lg md:text-2xl',
              },
            ].map((group) => (
              <div key={group.label} className="flex flex-col gap-3">
                <p className="mb-1 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                  {group.label}
                </p>
                {group.actions.map((act) => (
                  <button
                    key={act.id}
                    onClick={() => handleAction(act.id)}
                    disabled={loading}
                    className={`${group.size} font-bold uppercase tracking-tighter hover:text-primary transition-colors text-left group flex items-center gap-4 disabled:opacity-50`}
                  >
                    <span className="w-5 shrink-0 text-primary opacity-40 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.85,0,0.15,1)] group-hover:translate-x-1 group-hover:opacity-100 group-focus-visible:translate-x-1 group-focus-visible:opacity-100">→</span>
                    {act.label}
                  </button>
                ))}
              </div>
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
              <div className="result-box max-h-[70vh] overflow-y-auto difference-scroll pr-2 text-xl md:text-2xl font-mono text-foreground break-all leading-relaxed selection:bg-primary selection:text-primary-foreground">
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
