import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowsClockwise,
  MagnifyingGlass,
  WarningCircle,
  Calendar,
  ArrowUpRight,
  DownloadSimple,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import api from '../../../api/axios';
import { gsap } from 'gsap';
import { LoadingSignal } from '../../../components/LoadingSignal';
import { formatDateTime } from '../../../lib/format-time';

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
  api_updated?: boolean | string;
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
  const [dateInput, setDateInput] = useState<string>(getTodayString());
  const [queryDate, setQueryDate] = useState<string>(getTodayString());
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingImage, setDownloadingImage] = useState(false);
  const forceUpdateRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const dailyQuery = useQuery({
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
  });

  const loading = dailyQuery.isPending || dailyQuery.isFetching;
  const error =
    !dailyQuery.isError || dailyQuery.isFetching
      ? ''
      : axios.isAxiosError(dailyQuery.error)
        ? dailyQuery.error.response?.data?.detail || '系统发生错误'
        : '系统发生错误';

  const dailyResult = dailyQuery.data ?? null;

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
    if (!dailyResult || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
  }, [dailyResult]);

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (dateInput === queryDate) {
      void dailyQuery.refetch();
    } else {
      setQueryDate(dateInput);
    }
  };

  const handleSetToday = () => {
    const today = getTodayString();
    setDateInput(today);
    if (today === queryDate) {
      void dailyQuery.refetch();
    } else {
      setQueryDate(today);
    }
  };

  const handleForceRefresh = () => {
    forceUpdateRef.current = true;
    setRefreshing(true);
    void dailyQuery.refetch().finally(() => setRefreshing(false));
  };

  const handleTriggerDownloadImage = async () => {
    if (downloadingImage) return;
    setDownloadingImage(true);
    try {
      const targetDate = dailyResult?.date || queryDate;
      const res = await api.post<{ result: SixtySecondsImageResult }>(
        '/tools/sixty-seconds/image',
        { date: targetDate || undefined, force_update: false }
      );
      const imgData = res.data.result;
      handleDownloadImage(
        imgData.base64 || imgData.data_uri,
        imgData.date || targetDate
      );
    } catch (err) {
      console.error('Failed to fetch image for download:', err);
    } finally {
      setDownloadingImage(false);
    }
  };

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

              <button
                type="button"
                onClick={handleTriggerDownloadImage}
                disabled={downloadingImage || loading}
                className="flex h-12 px-6 flex-1 sm:flex-initial items-center justify-center gap-2 border border-border bg-background font-mono text-xs font-bold uppercase tracking-widest text-foreground hover:border-primary hover:text-primary transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {downloadingImage ? (
                  <ArrowsClockwise className="h-4 w-4 animate-spin" />
                ) : (
                  <DownloadSimple weight="bold" className="h-4 w-4" />
                )}
                <span>{downloadingImage ? '下载中...' : '下载长图'}</span>
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

        {/* 加载状态 */}
        {loading && !dailyResult && (
          <div className="flex min-h-72 items-center justify-center border border-border py-12">
            <LoadingSignal
              ariaLabel="正在加载 60s 每日新闻"
              label="[ 新闻要点加载中... ]"
              meta="60s / News"
            />
          </div>
        )}

        {/* 结果渲染 */}
        {dailyResult && (
          <div className="result-box grid grid-cols-1 lg:grid-cols-[minmax(0,672px)_minmax(0,1fr)] gap-10 xl:gap-16 items-start w-full">
            {/* 左列: 672px 海报 */}
            <div className="max-w-[672px] w-full mx-auto lg:mx-0 bg-gradient-to-br from-stone-50 via-amber-50/80 to-stone-100 border border-stone-200/60 p-6 sm:p-8 rounded-2xl shadow-xl shadow-stone-200/40 text-stone-800 selection:bg-amber-200">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-200/60 pb-6 mb-6 gap-4">
                {/* 左侧 */}
                <div className="flex flex-col gap-1">
                  <h2 className="text-2xl sm:text-3xl font-bold text-amber-600 tracking-tight">
                    每天 60 秒读懂世界
                  </h2>
                  <p className="font-mono text-xs sm:text-sm text-stone-500 font-normal">
                    {dailyResult.date || queryDate}
                    {dailyResult.lunar_date
                      ? ` · 农历${dailyResult.lunar_date.replace(/^农历/, '')}`
                      : ''}
                  </p>
                </div>

                {/* 中间斜线 */}
                <div className="w-[3px] h-10 bg-stone-300/80 skew-x-16 shrink-0 mx-1 sm:mx-2" />

                {/* 右侧 */}
                <div className="text-5xl sm:text-6xl font-bold text-stone-800 shrink-0 font-sans tracking-tight">
                  {dailyResult.day_of_week || '星期'}
                </div>
              </div>

              {/* NewsList */}
              {dailyResult.news && dailyResult.news.length > 0 && (
                <div className="space-y-3 my-6">
                  {dailyResult.news.map((item, idx) => {
                    const cleaned = cleanTitle(item.title);
                    return (
                      <div
                        key={`poster-item-${item.title}-${item.link || ''}`}
                        className="flex items-start gap-3 text-stone-800 text-base leading-6"
                      >
                        <span className="w-4 h-4 rounded-full bg-stone-200 text-stone-500 text-[10px] font-mono flex items-center justify-center shrink-0 mt-[3px] select-none">
                          {idx + 1}
                        </span>
                        <div className="flex-1 break-words">
                          {item.link ? (
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline hover:text-amber-700 transition-colors"
                            >
                              {cleaned}
                            </a>
                          ) : (
                            <span>{cleaned}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tip / 微语 */}
              {dailyResult.tip && (
                <div className="my-6 px-6 py-4 bg-amber-50/50 rounded-lg text-center text-stone-700 italic text-sm sm:text-base leading-relaxed border border-amber-100/60 relative">
                  <span className="text-amber-700/30 font-serif text-2xl font-bold mr-1 leading-none select-none">
                    「
                  </span>
                  <span>{dailyResult.tip}</span>
                  <span className="text-amber-700/30 font-serif text-2xl font-bold ml-1 leading-none select-none">
                    」
                  </span>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-end justify-between border-t border-stone-200/60 pt-4 mt-6 text-[0.625rem] text-stone-400 leading-tight gap-4">
                <div className="flex flex-col gap-1">
                  <div>新闻联播 / 人民日报 / 新华网 / 腾讯新闻 / 环球网 / 澎湃新闻</div>
                  <div>
                    共 {dailyResult.news?.length || 0} 条国内外精选新闻
                    {dailyResult.api_updated
                      ? ` / 更新于 ${formatDateTime(dailyResult.api_updated_at) || dailyResult.api_updated}`
                      : ''}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-right shrink-0">
                  <div>@ToolHub</div>
                  <div>React 界面 / TailwindCSS 样式</div>
                </div>
              </div>
            </div>

            {/* 右列: 信息面板 (仅在宽屏 ≥lg 显示) */}
            <div className="hidden lg:flex flex-col gap-6 min-w-0 p-6 border border-border bg-card/40 gsap-reveal">
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                [ 60S NEWS / 数据信息 ]
              </span>

              {/* 更新元数据卡 */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-6">
                <div className="min-w-0 border-t border-border pt-4">
                  <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                    更新时间
                  </span>
                  <span className="mt-2 block min-w-0 font-mono text-xl font-bold tracking-tight text-foreground break-words">
                    {formatDateTime(dailyResult.api_updated_at) ||
                      (typeof dailyResult.api_updated === 'string'
                        ? dailyResult.api_updated
                        : dailyResult.api_updated
                          ? '已更新'
                          : '已是最新')}
                  </span>
                </div>

                <div className="min-w-0 border-t border-border pt-4">
                  <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                    新闻条数
                  </span>
                  <span className="mt-2 block min-w-0 font-mono text-xl font-bold tracking-tight text-foreground break-words">
                    {dailyResult.news?.length || 0}
                    <span className="text-xs text-muted-foreground font-normal ml-1">条</span>
                  </span>
                </div>

                <div className="min-w-0 border-t border-border pt-4">
                  <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                    日期
                  </span>
                  <span className="mt-2 block min-w-0 font-mono text-xl font-bold tracking-tight text-foreground break-words">
                    {dailyResult.date || queryDate}
                  </span>
                </div>

                <div className="min-w-0 border-t border-border pt-4">
                  <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                    星期 / 农历
                  </span>
                  <span className="mt-2 block min-w-0 font-mono text-xl font-bold tracking-tight text-foreground break-words">
                    {dailyResult.day_of_week || '—'}
                    {dailyResult.lunar_date && (
                      <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                        农历{dailyResult.lunar_date.replace(/^农历/, '')}
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* 来源媒体列表 */}
              <div className="border-t border-border pt-4">
                <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                  来源媒体
                </span>
                <p className="mt-2 font-mono text-xs text-muted-foreground leading-relaxed">
                  新闻联播 / 人民日报 / 新华网 / 腾讯新闻 / 环球网 / 澎湃新闻
                </p>
              </div>

              {/* 操作按钮: 查看原文 */}
              {dailyResult.link && (
                <div className="border-t border-border pt-4">
                  <a
                    href={dailyResult.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center justify-center gap-2 border border-border bg-background px-6 font-mono text-xs font-bold uppercase tracking-widest text-foreground hover:border-primary hover:text-primary transition-all active:scale-95"
                  >
                    <span>查看原文</span>
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SixtySecondsTool;
