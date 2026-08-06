import React, { useState, useEffect, useRef } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import api from '../../../api/axios';
import { gsap } from 'gsap';

interface QrcodeResult {
  mime_type: string;
  text: string;
  base64: string;
  data_uri: string;
}

const ERROR_LEVELS = [
  { value: 'L', label: 'L', detail: '约 7% 纠错' },
  { value: 'M', label: 'M', detail: '约 15% 纠错' },
  { value: 'Q', label: 'Q', detail: '约 25% 纠错' },
  { value: 'H', label: 'H', detail: '约 30% 纠错' },
] as const;

/** base64 → Blob，用于本地下载 PNG。 */
const base64ToBlob = (base64: string, mimeType: string): Blob => {
  // 防御：兼容带 data URI 前缀的 base64。
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'image/png' });
};

const QrcodeGenerator: React.FC = () => {
  const [text, setText] = useState('');
  const [size, setSize] = useState(256);
  const [level, setLevel] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [qr, setQr] = useState<QrcodeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

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
        delay: 0.12,
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const handleGenerate = async () => {
    if (!text.trim()) {
      setError('需要提供二维码内容');
      return;
    }

    setError('');
    setLoading(true);
    setQr(null);

    try {
      const res = await api.post<{ result: QrcodeResult }>('/tools/qrcode', {
        text,
        size,
        level,
      });
      setQr(res.data.result);

      if (
        previewRef.current &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        gsap.fromTo(
          previewRef.current,
          { opacity: 0, scale: 0.97 },
          { opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out' },
        );
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '系统发生错误');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!qr) {
      return;
    }
    const blob = base64ToBlob(qr.base64, qr.mime_type);
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = `qrcode-${size}x${size}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  };

  const qrSize = Math.min(size, 512);

  return (
    <div ref={containerRef} className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto">
      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-16 xl:gap-24 relative z-10">
        {/* 左侧输入与操作 */}
        <div className="gsap-reveal flex flex-col">
          <div className="relative group mb-12">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="awwwards-input w-full h-40 resize-none font-mono text-xl leading-relaxed text-foreground selection:bg-primary selection:text-primary-foreground"
              placeholder=" "
              spellCheck={false}
              id="qrcode-text"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'qrcode-error' : undefined}
            />
            <label htmlFor="qrcode-text" className="pointer-events-none absolute left-0 top-4 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground transition-[color,transform] duration-300 group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8">
              二维码内容 (Content)
            </label>
            {error && (
              <div id="qrcode-error" role="alert" className="absolute -bottom-8 left-0 font-mono text-[0.6875rem] uppercase tracking-widest text-primary">
                [ 异常: {error} ]
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
            <div className="min-w-0">
              <div className="flex items-end justify-between mb-6">
                <label htmlFor="qrcode-size" className="text-[0.6875rem] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  尺寸 (Size)
                </label>
                <span className="text-xl font-bold font-mono text-primary">{size}px</span>
              </div>
              <input
                type="range"
                id="qrcode-size"
                min="64"
                max="1024"
                step="8"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                aria-label="二维码尺寸"
                className="h-[2px] w-full cursor-pointer appearance-none rounded-none bg-border [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:bg-primary active:[&::-webkit-slider-thumb]:scale-75"
              />
            </div>

            <div className="min-w-0">
              <p className="mb-4 text-[0.6875rem] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                纠错级别 (Level)
              </p>
              <div className="flex flex-wrap gap-px bg-border border border-border">
                {ERROR_LEVELS.map((option) => {
                  const selected = option.value === level;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setLevel(option.value)}
                      aria-pressed={selected}
                      className={`flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 px-4 py-3 transition-colors ${
                        selected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground hover:text-primary'
                      }`}
                    >
                      <span className="text-lg font-bold tracking-tighter">{option.label}</span>
                      <span className="font-mono text-[0.5625rem] uppercase tracking-[0.15em]">
                        {option.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-12">
            <button
              onClick={() => void handleGenerate()}
              disabled={loading}
              className="text-2xl md:text-4xl font-bold uppercase tracking-tighter hover:text-primary transition-colors text-left group flex items-center gap-4 disabled:opacity-50"
            >
              <span className="w-5 shrink-0 text-primary opacity-40 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.85,0,0.15,1)] group-hover:translate-x-1 group-hover:opacity-100 group-focus-visible:translate-x-1 group-focus-visible:opacity-100">
                {loading ? <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-r-transparent" /> : '→'}
              </span>
              生成二维码
            </button>
          </div>
        </div>

        {/* 右侧预览 */}
        <div className="gsap-reveal flex flex-col pt-4 lg:pt-0">
          <p className="mb-6 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">输出流 (Output Stream)</p>

          <div className="flex min-h-[300px] flex-1 flex-col justify-center border-l-2 border-border pl-8 md:pl-12">
            {loading ? (
              <div role="status" className="text-3xl font-bold tracking-tighter uppercase text-muted-foreground animate-pulse">
                生成中...
              </div>
            ) : qr ? (
              <div ref={previewRef} className="flex w-full flex-col items-center gap-8">
                <div className="inline-flex w-fit max-w-full flex-col gap-3 border border-border bg-background p-4">
                  <img
                    src={qr.data_uri}
                    alt={`二维码：${qr.text}`}
                    width={qrSize}
                    height={qrSize}
                    className="h-auto w-full max-w-[400px] object-contain image-rendering-pixelated"
                  />
                  <p className="font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground">
                    {qr.text.length > 48 ? `${qr.text.slice(0, 48)}…` : qr.text}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex w-fit items-center gap-3 whitespace-nowrap bg-foreground px-6 py-4 font-bold uppercase tracking-tight text-background transition-colors hover:bg-primary hover:text-primary-foreground active:scale-95"
                >
                  <DownloadSimple weight="bold" className="size-5" />
                  下载 PNG
                </button>
              </div>
            ) : (
              <div className="text-3xl font-bold tracking-tighter uppercase text-border">
                等待<br/>内容输入
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QrcodeGenerator;
