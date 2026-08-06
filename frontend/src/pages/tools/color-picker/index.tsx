import React, { useState, useEffect, useRef } from 'react';
import { Palette } from '@phosphor-icons/react';
import api from '../../../api/axios';
import { gsap } from 'gsap';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

interface CmykColor {
  c: number;
  m: number;
  y: number;
  k: number;
}

interface ColorConvertResult {
  hex: string;
  name: string;
  rgb: RgbColor;
  hsl: HslColor;
  cmyk: CmykColor;
  complementary: string;
}

interface PaletteColor {
  hex: string;
  name: string;
  role: string;
  theory: string;
}

interface ColorPalette {
  name: string;
  description: string;
  colors: PaletteColor[];
}

interface ColorPaletteResult {
  input: {
    hex: string;
    rgb: RgbColor;
    hsl: HslColor;
    name: string;
  };
  palettes: ColorPalette[];
  metadata: {
    total_palettes?: number;
    color_theory?: string;
    applications?: string[];
  };
}

const HEX_PATTERN = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const normalizeHex = (value: string): string => {
  const trimmed = value.trim().replace(/^#/, '');
  if (trimmed.length === 3) {
    return `#${trimmed
      .split('')
      .map((char) => char + char)
      .join('')
      .toUpperCase()}`;
  }
  return `#${trimmed.toUpperCase()}`;
};

const isValidHex = (value: string): boolean => HEX_PATTERN.test(value.trim());

const ColorPicker: React.FC = () => {
  const [colorInput, setColorInput] = useState('');
  const [converted, setConverted] = useState<ColorConvertResult | null>(null);
  const [palettes, setPalettes] = useState<ColorPaletteResult | null>(null);
  const [converting, setConverting] = useState(false);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [error, setError] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);

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

  const animateBlock = () => {
    if (
      blockRef.current &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      gsap.fromTo(
        blockRef.current,
        { opacity: 0.4, scale: 0.985 },
        { opacity: 1, scale: 1, duration: 0.55, ease: 'expo.out' },
      );
    }
  };

  const handleConvert = async (color: string) => {
    setError('');
    setConverting(true);
    try {
      const res = await api.post<{ result: ColorConvertResult }>(
        '/tools/color/convert',
        { color },
      );
      setConverted(res.data.result);
      animateBlock();
    } catch (err: any) {
      setError(err.response?.data?.detail || '系统发生错误');
    } finally {
      setConverting(false);
    }
  };

  const handleRandom = async () => {
    setError('');
    setConverting(true);
    try {
      const res = await api.post<{ result: ColorConvertResult }>(
        '/tools/color/convert',
        {},
      );
      setConverted(res.data.result);
      setColorInput(res.data.result.hex);
      animateBlock();
    } catch (err: any) {
      setError(err.response?.data?.detail || '系统发生错误');
    } finally {
      setConverting(false);
    }
  };

  const handlePalette = async () => {
    setError('');
    setPaletteLoading(true);
    try {
      const body = colorInput.trim()
        ? { color: colorInput.trim() }
        : {};
      const res = await api.post<{ result: ColorPaletteResult }>(
        '/tools/color/palette',
        body,
      );
      setPalettes(res.data.result);
      if (
        res.data.result.input?.hex &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        setTimeout(() => {
          gsap.fromTo(
            '.palette-section',
            { opacity: 0, y: 16 },
            { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out' },
          );
        }, 50);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '系统发生错误');
    } finally {
      setPaletteLoading(false);
    }
  };

  const onSubmitConvert = () => {
    const input = colorInput.trim();
    if (!input) {
      setError('请输入 HEX 颜色，或点击“随机颜色”');
      return;
    }
    if (!isValidHex(input)) {
      setError('无效的颜色编码，请输入 #RRGGBB 或 RRGGBB');
      return;
    }
    void handleConvert(input);
  };

  const displayHex =
    converted?.hex ??
    (isValidHex(colorInput) ? normalizeHex(colorInput) : '');

  const convertedResult = converted;

  return (
    <div ref={containerRef} className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto">
      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-16 xl:gap-24 relative z-10">
        {/* 左侧输入与操作 */}
        <div className="gsap-reveal flex flex-col">
          <div className="relative group mb-12">
            <input
              type="text"
              value={colorInput}
              onChange={(e) => setColorInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onSubmitConvert();
                }
              }}
              className="awwwards-input w-full font-mono text-xl leading-relaxed text-foreground selection:bg-primary selection:text-primary-foreground"
              placeholder=" "
              spellCheck={false}
              id="hex-input"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'color-error' : undefined}
            />
            <label htmlFor="hex-input" className="pointer-events-none absolute left-0 top-4 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground transition-[color,transform] duration-300 group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8">
              HEX 颜色 (HEX Color)
            </label>
            {error && (
              <div id="color-error" role="alert" className="absolute -bottom-8 left-0 font-mono text-[0.6875rem] uppercase tracking-widest text-primary">
                [ 异常: {error} ]
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">执行指令</p>
            <div className="flex flex-wrap gap-x-10 gap-y-6">
            {[
              { id: 'convert', label: '转换', onClick: onSubmitConvert, disabled: converting, loading: converting },
              { id: 'random', label: '随机颜色', onClick: () => void handleRandom(), disabled: converting, loading: converting },
              { id: 'palette', label: '生成配色方案', onClick: () => void handlePalette(), disabled: paletteLoading, loading: paletteLoading },
            ].map((act) => (
              <button
                key={act.id}
                onClick={act.onClick}
                disabled={act.disabled}
                className="text-2xl md:text-4xl font-bold uppercase tracking-tighter hover:text-primary transition-colors text-left group flex items-center gap-4 disabled:opacity-50"
              >
                <span className="w-5 shrink-0 text-primary opacity-40 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.85,0,0.15,1)] group-hover:translate-x-1 group-hover:opacity-100 group-focus-visible:translate-x-1 group-focus-visible:opacity-100">
                  {act.loading ? <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-r-transparent" /> : '→'}
                </span>
                {act.label}
              </button>
            ))}
            </div>
          </div>
        </div>

        {/* 右侧展示 */}
        <div className="gsap-reveal flex flex-col pt-4 lg:pt-0">
          <p className="mb-6 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">输出流 (Output Stream)</p>

          <div className="flex-1 min-w-0 border-l-2 border-border pl-8 md:pl-12">
            {convertedResult ? (
              <div className="flex flex-col gap-8">
                <div
                  ref={blockRef}
                  className="relative flex h-56 md:h-72 items-end justify-between overflow-hidden border border-border bg-background p-6"
                  style={{ backgroundColor: displayHex }}
                >
                  <span className="font-mono text-xs uppercase tracking-[0.2em] text-white mix-blend-difference">
                    {convertedResult.name || '—'}
                  </span>
                  <span className="font-mono text-2xl font-bold uppercase tracking-widest text-white mix-blend-difference">
                    {convertedResult.hex}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-6 font-mono text-sm">
                  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3">
                    <span className="text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">RGB</span>
                    <span className="tabular-nums text-foreground">
                      rgb({convertedResult.rgb?.r}, {convertedResult.rgb?.g}, {convertedResult.rgb?.b})
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3">
                    <span className="text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">HSL</span>
                    <span className="tabular-nums text-foreground">
                      hsl({convertedResult.hsl?.h}°, {convertedResult.hsl?.s}%, {convertedResult.hsl?.l}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3">
                    <span className="text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">CMYK</span>
                    <span className="tabular-nums text-foreground">
                      cmyk({convertedResult.cmyk?.c}%, {convertedResult.cmyk?.m}%, {convertedResult.cmyk?.y}%, {convertedResult.cmyk?.k}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3">
                    <span className="text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">互补色</span>
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="inline-block size-5 border border-border"
                        style={{ backgroundColor: convertedResult.complementary }}
                      />
                      <span className="tabular-nums uppercase text-foreground">{convertedResult.complementary}</span>
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-3xl font-bold tracking-tighter uppercase text-border">
                等待<br/>颜色输入
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 配色方案 */}
      {palettes && (
        <section className="palette-section mt-20 border-t-2 border-border pt-12" aria-labelledby="palette-title">
          <div className="mb-10 flex items-center gap-5">
            <Palette weight="bold" className="size-8 shrink-0 text-primary" />
            <div>
              <h2 id="palette-title" className="text-2xl md:text-3xl font-bold tracking-tight">
                配色方案
              </h2>
              <p className="mt-1 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                {palettes.input?.name} · {palettes.input?.hex} · {palettes.metadata?.total_palettes ?? palettes.palettes.length} 组方案
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-14">
            {palettes.palettes.map((palette) => (
              <div key={palette.name} className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-8">
                <div className="min-w-0">
                  <h3 className="text-xl md:text-2xl font-bold tracking-tight">{palette.name}</h3>
                  <p className="mt-3 max-w-xs font-mono text-xs leading-relaxed text-muted-foreground">
                    {palette.description}
                  </p>
                </div>
                <div className="grid min-w-0 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-px border border-border bg-border">
                  {palette.colors.map((color) => (
                    <div key={`${palette.name}-${color.hex}`} className="flex min-w-0 flex-col bg-background">
                      <div
                        aria-label={`${color.name} ${color.hex}`}
                        className="h-20 md:h-24 w-full"
                        style={{ backgroundColor: color.hex }}
                      />
                      <div className="flex min-w-0 flex-col gap-1 border-t border-border p-3">
                        <span className="truncate font-mono text-xs font-bold uppercase tracking-wider text-foreground">
                          {color.hex}
                        </span>
                        <span className="truncate text-xs text-foreground">{color.name}</span>
                        <span className="truncate font-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground">
                          {color.role} · {color.theory}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {palettes.metadata?.applications && palettes.metadata.applications.length > 0 && (
            <p className="mt-12 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              适用场景：{palettes.metadata.applications.join(' · ')}
            </p>
          )}
        </section>
      )}
    </div>
  );
};

export default ColorPicker;
