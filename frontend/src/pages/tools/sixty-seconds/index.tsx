import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowsClockwise,
  MagnifyingGlass,
  WarningCircle,
  Calendar,
  ArrowUpRight,
  Quotes,
  DownloadSimple,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import api from '../../../api/axios';
import { gsap } from 'gsap';
import { LoadingSignal } from '../../../components/LoadingSignal';

interface NewsItem {
  title: string;
  link?: string | null;
}

interface SixtySecondsResult {
  date?: string;
  day_of_week?: string;
  lunar_date?: string;
  news?: NewsItem[];
  tip?: string;
  cover?: string;
  image?: string;
  link?: string;
  api_updated?: boolean;
  api_updated_at?: string;
}

interface SixtySecondsImageResult {
  date: string;
  mime_type: string;
  base64: string;
  data_uri: string;
}

const getTodayString = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const cleanTitle = (rawTitle: string): string => {
  if (!rawTitle) return '';
  // 移除开头的 "1.", "1、", "01.", "【1】" 等重复编号
  return rawTitle.replace(/^(?:\d+[.、\s]|\d+\s+|【\d+】)\s*/, '').trim();
};

const handleDownloadImage = (base64Data: string, date: string) => {
  if (!base64Data) return;
  try {
    const base64Str = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const byteCharacters = atob(base64Str);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `60s-${date || getTodayString()}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to download image:', err);
  }
};

const SixtySecondsTool: React.FC = () => {
  const [viewMode, setViewMode] = useState<'image' | 'text'>('image');
  const [dateInput, setDateInput] = useState<string>(getTodayString());
  const [queryDate, setQueryDate] = useState<string>(getTodayString());
  const [refreshing, setRefreshing] = useState(false);
  const forceUpdateRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const imageQuery = useQuery({
    queryKey: ['sixty-seconds-image', queryDate],
    queryFn: async ({ signal }) => {
      const forceUpdate = forceUpdateRef.current;
      forceUpdateRef.current = false;
      const res = await api.post<{ result: SixtySecondsImageResult }>(
        '/tools/sixty-seconds/image',
        { date: queryDate || undefined, force_update: forceUpdate },
        { signal }
      );
      return res.data.result;
    },
    enabled: viewMode === 'image',
  });

  const textQuery = useQuery({
    queryKey: ['sixty-seconds', queryDate],
    queryFn: async ({ signal }) => {
      const forceUpdate = forceUpdateRef.current;
      forceUpdateRef.current = false;
      const res = await api.post<{ result: SixtySecondsResult }>(
        '/tools/sixty-seconds/daily',
        { date: queryDate || undefined, force_update: forceUpdate },
        { signal }
      );
      return res.data.result;
    },
    enabled: viewMode === 'text',
  });

  const activeQuery = viewMode === 'image' ? imageQuery : textQuery;
  const loading = activeQuery.isPending || activeQuery.isFetching;
  const error =
    !activeQuery.isError || activeQuery.isFetching
      ? ''
      : axios.isAxiosError(activeQuery.error)
        ? activeQuery.error.response?.data?.detail || '系统发生错误'
        : '系统发生错误';

  const imageResult = imageQuery.data ?? null;
  const textResult = textQuery.data ?? null;

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

  useEffect(() => {
    const activeResult = viewMode === 'image' ? imageResult : textResult;
    if (!activeResult || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const timer = setTimeout(() => {
      gsap.fromTo(
        '.result-box',
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' }
      );
    }, 50);
    return () => clearTimeout(timer);
  }, [imageResult, textResult, viewMode]);

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (dateInput === queryDate) {
      if (viewMode === 'image') {
        void imageQuery.refetch();
      } else {
        void textQuery.refetch();
      }
    } else {
      setQueryDate(dateInput);
    }
  };

  const handleSetToday = () => {
    const today = getTodayString();
    setDateInput(today);
    if (today === queryDate) {
      if (viewMode === 'image') {
        void imageQuery.refetch();
      } else {
        void textQuery.refetch();
      }
    } else {
      setQueryDate(today);
    }
  };

  const handleForceRefresh = () => {
    forceUpdateRef.current = true;
    setRefreshing(true);
    const activeRefetch = viewMode === 'image' ? imageQuery.refetch() : textQuery.refetch();
    void activeRefetch.finally(() => setRefreshing(false));
  };

  const coverImageUrl = textResult?.cover || textResult?.image;

  return (
    <div
      ref={containerRef}
      className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto"
    >
      <div className="relative z-10 flex flex-col gap-12">
        {/* 控制与工具栏 */}
        <div className="gsap-reveal border-b border-border pb-8">
          <form onSubmit={handleQuery} className="flex flex-col sm:flex-row items-end justify-between gap-6">
            <div className="relative group w-full sm:max-w-xs">
              <input
                type="date"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className="awwwards-input w-full font-mono text-xl text-foreground selection:bg-primary selection:text-primary-foreground"
                id="news-date-input"
              />
              <label
                htmlFor="news-date-input"
                className="pointer-events-none absolute left-0 top-4 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground transition-[color,transform] duration-300 group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8"
              >
                选择日期 (DATE)
              </label>
            </div>

            <div className="flex w-full sm:w-auto items-center gap-4 flex-wrap">
              {/* 分段按钮：图片版 | 文字版 */}
              <div className="flex w-full sm:w-auto gap-px bg-border border border-border shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('image')}
                  aria-pressed={viewMode === 'image'}
                  className={`flex-1 sm:flex-initial h-12 px-5 flex items-center justify-center font-mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    viewMode === 'image'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:text-primary'
                  }`}
                >
                  图片版
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('text')}
                  aria-pressed={viewMode === 'text'}
                  className={`flex-1 sm:flex-initial h-12 px-5 flex items-center justify-center font-mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    viewMode === 'text'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:text-primary'
                  }`}
                >
                  文字版
                </button>
              </div>

              <button
                type="button"
                onClick={handleSetToday}
                className="flex h-12 px-5 items-center justify-center border border-border bg-transparent font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground hover:border-foreground hover:text-foreground transition-all active:scale-95 cursor-pointer"
              >
                <Calendar className="mr-2 h-4 w-4" />
                <span>今天</span>
              </button>

              <button
                type="submit"
                disabled={loading || refreshing}
                className="flex h-12 px-6 flex-1 sm:flex-initial items-center justify-center gap-2 border border-border bg-transparent font-mono text-xs font-bold uppercase tracking-widest text-foreground hover:border-primary hover:text-primary transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <ArrowsClockwise className="h-4 w-4 animate-spin" />
                ) : (
                  <MagnifyingGlass className="h-4 w-4" />
                )}
                <span>查询</span>
              </button>

              <button
                type="button"
                onClick={handleForceRefresh}
                disabled={loading || refreshing}
                className="flex h-12 px-6 flex-1 sm:flex-initial items-center justify-center gap-2 border border-primary bg-primary font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground transition-all hover:opacity-95 active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                <ArrowsClockwise className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span>强制刷新</span>
              </button>
            </div>
          </form>

          {error && (
            <div role="alert" className="mt-4 flex items-center gap-2 font-mono text-xs text-destructive">
              <WarningCircle className="h-4 w-4 shrink-0" />
              <span>[ 异常: {error} ]</span>
            </div>
          )}
        </div>

        {/* 图片版 viewMode === 'image' */}
        {viewMode === 'image' && (
          <>
            {loading && !imageResult && (
              <div className="flex min-h-72 items-center justify-center border border-border py-12">
                <LoadingSignal
                  ariaLabel="正在加载 60s 每日新闻图片"
                  label="[ 图片加载中... ]"
                  meta="60s / Image"
                />
              </div>
            )}

            {imageResult && (
              <div className="result-box flex flex-col gap-8">
                {/* 头部元信息 & 下载按钮 */}
                <div className="gsap-reveal flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                      [ 60 SECONDS DAILY NEWS / 60s 每日新闻长图 ]
                    </span>
                    <h1 className="font-heading text-3xl sm:text-5xl font-bold tracking-tight text-foreground">
                      {imageResult.date || queryDate}
                    </h1>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadImage(
                        imageResult.base64 || imageResult.data_uri,
                        imageResult.date || queryDate
                      )
                    }
                    className="flex h-12 px-6 items-center justify-center gap-2 border border-primary bg-primary font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground transition-all hover:opacity-95 active:scale-95 cursor-pointer w-full sm:w-auto"
                  >
                    <DownloadSimple weight="bold" className="h-4 w-4" />
                    <span>下载图片</span>
                  </button>
                </div>

                {/* 图片展示 */}
                <div className="gsap-reveal border border-border bg-background p-2 sm:p-4 flex flex-col items-center gap-6">
                  <img
                    src={imageResult.data_uri}
                    alt={`60s 每日新闻 ${imageResult.date || queryDate}`}
                    className="max-w-full h-auto border border-border bg-background"
                  />
                  <p className="font-mono text-xs text-muted-foreground text-center">
                    {imageResult.date || queryDate} · 每日 60s 读懂世界
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* 文字版 viewMode === 'text' */}
        {viewMode === 'text' && (
          <>
            {loading && !textResult && (
              <div className="flex min-h-72 items-center justify-center border border-border py-12">
                <LoadingSignal
                  ariaLabel="正在加载 60s 每日新闻文字版"
                  label="[ 新闻要点加载中... ]"
                  meta="60s / Text"
                />
              </div>
            )}

            {textResult && (
              <div className="result-box flex flex-col gap-12">
                {/* Header / 头部元信息 */}
                <div className="gsap-reveal flex flex-col gap-4 border-b border-border pb-10">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                      [ 60 SECONDS DAILY NEWS / 60s 每日新闻 ]
                    </span>
                    {textResult.api_updated_at && (
                      <span className="font-mono text-xs text-muted-foreground border border-border px-3 py-1">
                        [ 更新于 {textResult.api_updated_at} ]
                      </span>
                    )}
                  </div>

                  <h1 className="font-heading text-4xl sm:text-6xl font-bold tracking-tight text-foreground">
                    {textResult.date || dateInput} {textResult.day_of_week}
                  </h1>

                  {textResult.lunar_date && (
                    <p className="font-mono text-sm text-muted-foreground">
                      农历: {textResult.lunar_date}
                    </p>
                  )}
                </div>

                {/* 封面图片 (Cover / Image) */}
                {coverImageUrl && (
                  <div className="gsap-reveal border border-border bg-muted/20 overflow-hidden">
                    <img
                      src={coverImageUrl}
                      alt="60s Daily News Cover"
                      className="w-full max-h-[32rem] object-contain mx-auto"
                      loading="lazy"
                    />
                  </div>
                )}

                {/* 新闻列表 (Grid 2 列) */}
                {textResult.news && textResult.news.length > 0 && (
                  <div className="gsap-reveal flex flex-col gap-6">
                    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                      [ BRIEFING ITEMS / 今日新闻要点 ]
                    </span>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-6 border-t border-border pt-8">
                      {textResult.news.map((item, idx) => {
                        const newsNum = String(idx + 1).padStart(2, '0');
                        const cleaned = cleanTitle(item.title);

                        return (
                          <div
                            key={`news-${newsNum}-${item.title}`}
                            className="flex items-start gap-4 p-4 border border-border bg-card/40 hover:border-primary/50 transition-colors group"
                          >
                            <span className="font-mono text-base font-bold text-primary shrink-0 select-none">
                              {newsNum}.
                            </span>
                            <div className="flex-1 flex flex-col gap-1 min-w-0">
                              {item.link ? (
                                <a
                                  href={item.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-base text-foreground font-medium group-hover:text-primary transition-colors flex items-center justify-between gap-2 break-words"
                                >
                                  <span>{cleaned}</span>
                                  <ArrowUpRight className="h-4 w-4 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
                                </a>
                              ) : (
                                <span className="text-base text-foreground font-medium break-words leading-relaxed">
                                  {cleaned}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 60s 微语 / Tips */}
                {textResult.tip && (
                  <div className="gsap-reveal border border-border bg-muted/30 p-8 relative flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <Quotes className="h-6 w-6 text-primary" />
                      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-primary font-bold">
                        [ 60S TIP / 每日微语 ]
                      </span>
                    </div>
                    <p className="font-mono text-base md:text-lg italic text-foreground leading-relaxed pl-2">
                      {textResult.tip}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SixtySecondsTool;
