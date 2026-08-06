import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Moon, MagnifyingGlass, ArrowsClockwise, WarningCircle, Quotes } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import api from '../../../api/axios';
import { gsap } from 'gsap';

interface SixtyCycleItem {
  name?: string;
  heaven_stem?: string;
  earth_branch?: string;
}

interface CalendarResult {
  // lunar 块
  solar?: {
    year?: number;
    month?: number;
    day?: number;
    full?: string;
    week_desc?: string;
    season_desc?: string;
    is_leap_year?: boolean;
  };
  lunar?: {
    desc_short?: string;
    year_desc?: string;
    month_desc?: string;
    day_desc?: string;
    hour_desc?: string;
    is_leap_month?: boolean;
  };
  stats?: {
    day_of_year?: number;
    week_of_year?: number;
    week_of_month?: number;
  };
  term?: {
    today?: string | null;
    stage?: {
      name?: string;
      position?: string;
      is_jie?: boolean;
      is_qi?: boolean;
    };
  };
  zodiac?:
    | {
        year?: string;
        month?: string;
        day?: string;
        hour?: string;
      }
    | string;
  sixty_cycle?: {
    year?: SixtyCycleItem;
    month?: SixtyCycleItem;
    day?: SixtyCycleItem;
    hour?: SixtyCycleItem;
  };
  taboo?: {
    day?: {
      recommends?: string;
      avoids?: string;
    };
    hour?: {
      hour?: string;
      hour_short?: string;
      recommends?: string;
      avoids?: string;
    };
    hours?: Array<{
      hour?: string;
      hour_short?: string;
      recommends?: string;
      avoids?: string;
    }>;
  };
  constellation?: {
    name?: string;
    name_short?: string;
  };
  phase?: {
    name?: string;
    position?: number;
  };
  nayin?: {
    year?: string;
    month?: string;
    day?: string;
    hour?: string;
  };
  baizi?: {
    year_baizi?: string;
    day_baizi?: string;
  };
  fortune?: {
    today_luck?: string;
    career?: string;
    money?: string;
    love?: string;
  };
  festival?: {
    solar?: string | null;
    lunar?: string | null;
    both_desc?: string | null;
  };
  // moyu 块
  date?: {
    gregorian?: string;
    weekday?: string;
    dayOfWeek?: number;
    lunar?: {
      yearCN?: string;
      monthCN?: string;
      dayCN?: string;
      zodiac?: string;
      yearGanZhi?: string;
      monthGanZhi?: string;
      dayGanZhi?: string;
    };
  };
  today?: {
    isWeekend?: boolean;
    isHoliday?: boolean;
    holidayName?: string | null;
    solarTerm?: string;
    lunarFestivals?: string[];
    isWorkday?: boolean;
  };
  currentHoliday?: {
    name?: string;
    dayOfHoliday?: number;
    daysRemaining?: number;
  } | null;
  nextHoliday?: {
    name?: string;
    date?: string;
    duration?: number;
    until?: number;
    workdays?: string[];
  } | null;
  countdown?: {
    toWeekEnd?: number;
    toFriday?: number;
    toMonthEnd?: number;
    toYearEnd?: number;
  };
  progress?: {
    week?: { percentage?: number };
    month?: { percentage?: number };
    year?: { percentage?: number };
  };
  moyuQuote?: string;
}

const getTodayString = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const CalendarTool: React.FC = () => {
  const [dateInput, setDateInput] = useState<string>(getTodayString());
  const [queryDate, setQueryDate] = useState<string>(getTodayString());

  const containerRef = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: ['calendar', queryDate],
    queryFn: async ({ signal }) => {
      const res = await api.post<{ result: CalendarResult }>(
        '/tools/calendar/info',
        { date: queryDate || undefined },
        { signal },
      );
      return res.data.result;
    },
  });

  const loading = query.isPending || query.isFetching;
  const error = !query.isError || query.isFetching
    ? ''
    : axios.isAxiosError(query.error)
      ? query.error.response?.data?.detail || '系统发生错误'
      : '系统发生错误';
  const result = query.data ?? null;

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
    if (!result || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
  }, [result]);

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (dateInput === queryDate) {
      void query.refetch();
    } else {
      setQueryDate(dateInput);
    }
  };

  const handleSetToday = () => {
    const today = getTodayString();
    setDateInput(today);
    if (today === queryDate) {
      void query.refetch();
    } else {
      setQueryDate(today);
    }
  };

  const renderStatusBadge = () => {
    if (!result?.today) return null;
    const { isHoliday, isWeekend, isWorkday, holidayName } = result.today;

    if (isHoliday) {
      return (
        <span className="border border-status-warning-foreground bg-status-warning-surface px-4 py-1.5 font-mono text-sm font-bold text-status-warning-foreground">
          [ 节假日: {holidayName || '休假'} ]
        </span>
      );
    }
    if (isWeekend) {
      return (
        <span className="border border-status-success-foreground bg-status-success-surface px-4 py-1.5 font-mono text-sm font-bold text-status-success-foreground">
          [ 周末休假 ]
        </span>
      );
    }
    if (isWorkday) {
      return (
        <span className="border border-primary bg-primary/10 px-4 py-1.5 font-mono text-sm font-bold text-primary">
          [ 工作日 · 努力摸鱼 ]
        </span>
      );
    }
    return null;
  };

  const getStatusTitle = () => {
    if (!result?.today) return '今日日历';
    const { isHoliday, isWeekend, holidayName } = result.today;
    if (isHoliday) return `今天是 节假日 (${holidayName || '休假'})`;
    if (isWeekend) return '今天是 周末双休';
    return '今天是 工作日';
  };

  const getYiList = (): string[] => {
    const raw = result?.taboo?.day?.recommends;
    if (!raw) return [];
    return raw.split(/[.\s,，]+/).filter(Boolean);
  };

  const getJiList = (): string[] => {
    const raw = result?.taboo?.day?.avoids;
    if (!raw) return [];
    return raw.split(/[.\s,，]+/).filter(Boolean);
  };

  const getZodiacText = (): string => {
    if (!result?.zodiac) return '--';
    if (typeof result.zodiac === 'string') return result.zodiac;
    return result.zodiac.year ? `生肖${result.zodiac.year}` : '--';
  };

  return (
    <div
      ref={containerRef}
      className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto"
    >
      <div className="relative z-10 flex flex-col gap-12">
        {/* Search & Actions Bar */}
        <div className="gsap-reveal border-b border-border pb-8">
          <form onSubmit={handleQuery} className="flex flex-col sm:flex-row items-end gap-6">
            <div className="relative group w-full sm:max-w-xs">
              <input
                type="date"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className="awwwards-input w-full font-mono text-xl text-foreground selection:bg-primary selection:text-primary-foreground"
                id="calendar-date-input"
              />
              <label
                htmlFor="calendar-date-input"
                className="pointer-events-none absolute left-0 top-4 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground transition-[color,transform] duration-300 group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8"
              >
                查询日期 (DATE)
              </label>
            </div>

            <div className="flex w-full sm:w-auto items-center gap-4">
              <button
                type="button"
                onClick={handleSetToday}
                className="flex h-12 px-6 items-center justify-center border border-border bg-transparent font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground hover:border-foreground hover:text-foreground transition-all active:scale-95 cursor-pointer"
              >
                <Calendar className="mr-2 h-4 w-4" />
                <span>今天</span>
              </button>

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 px-8 flex-1 sm:flex-initial items-center justify-center gap-2 border border-primary bg-primary font-mono text-xs font-bold uppercase tracking-widest text-primary-foreground transition-all hover:opacity-95 active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <>
                    <ArrowsClockwise className="h-4 w-4 animate-spin" />
                    <span>查询中</span>
                  </>
                ) : (
                  <>
                    <MagnifyingGlass className="h-4 w-4" />
                    <span>查询日历</span>
                  </>
                )}
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

        {/* Results Workbench */}
        {result && (
          <div className="result-box flex flex-col gap-12">
            {/* 顶部今日状态 Hero */}
            <div className="gsap-reveal flex flex-col gap-4 border-b border-border pb-10">
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                [ CALENDAR / 今日日历 ]
              </span>
              <div className="flex flex-wrap items-center justify-between gap-6">
                <h1 className="font-heading text-4xl sm:text-6xl font-bold tracking-tight text-foreground break-words">
                  {getStatusTitle()}
                </h1>
                <div>{renderStatusBadge()}</div>
              </div>

              {/* 当前假期提示 */}
              {result.currentHoliday && (
                <div className="mt-2 border border-status-warning-foreground bg-status-warning-surface/30 p-4 font-mono text-sm text-status-warning-foreground">
                  🎉 正在休假中：{result.currentHoliday.name}（第 {result.currentHoliday.dayOfHoliday} 天，剩余 {result.currentHoliday.daysRemaining} 天）
                </div>
              )}

              {/* 基础公历 */}
              <div className="flex flex-wrap items-center gap-4 font-mono text-sm text-muted-foreground mt-2">
                <span>公历: {result.date?.gregorian}</span>
                <span>•</span>
                <span>{result.date?.weekday}</span>
              </div>
            </div>

            {/* 大字农历 + 季节信息 */}
            <div className="gsap-reveal flex flex-col gap-4 border-b border-border pb-10">
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                [ LUNAR DATE / 农历黄历 ]
              </span>
              <h1 className="font-heading text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight text-foreground leading-tight break-words">
                {result.lunar?.desc_short ||
                  `${result.lunar?.year_desc || ''} ${result.lunar?.month_desc || ''}${result.lunar?.day_desc || ''}`}
              </h1>
              {result.solar?.season_desc && (
                <div className="flex flex-wrap items-center gap-4 font-mono text-sm text-muted-foreground">
                  <span>{result.solar.season_desc}</span>
                </div>
              )}
            </div>

            {/* 六十甲子 (四柱) */}
            {result.sixty_cycle && (
              <div className="gsap-reveal flex flex-col gap-4">
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                  [ FOUR PILLARS / 干支历法 ]
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-border pt-6">
                  <div className="flex flex-col gap-1 border-r border-border pr-4">
                    <span className="font-mono text-xs text-muted-foreground">年柱 (YEAR)</span>
                    <span className="font-mono text-2xl font-bold text-foreground">
                      {result.sixty_cycle.year?.name || '--'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 border-r border-border pr-4">
                    <span className="font-mono text-xs text-muted-foreground">月柱 (MONTH)</span>
                    <span className="font-mono text-2xl font-bold text-foreground">
                      {result.sixty_cycle.month?.name || '--'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 border-r border-border pr-4">
                    <span className="font-mono text-xs text-muted-foreground">日柱 (DAY)</span>
                    <span className="font-mono text-2xl font-bold text-foreground">
                      {result.sixty_cycle.day?.name || '--'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-xs text-muted-foreground">时柱 (HOUR)</span>
                    <span className="font-mono text-2xl font-bold text-foreground">
                      {result.sixty_cycle.hour?.name || '--'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 生肖星座 / 节气 / 统计 */}
            <div className="gsap-reveal grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex flex-col gap-2 border border-border p-6 bg-muted/20">
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                  [ ZODIAC / 生肖星座 ]
                </span>
                <span className="font-mono text-xl font-bold text-foreground break-words">
                  {getZodiacText()}
                  {result.constellation?.name ? ` · ${result.constellation.name}` : ''}
                </span>
              </div>

              <div className="flex flex-col gap-2 border border-border p-6 bg-muted/20">
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                  [ SOLAR TERM / 节气 ]
                </span>
                <span className="font-mono text-xl font-bold text-foreground">
                  {result.term?.today || result.term?.stage?.name || '无节气'}
                </span>
              </div>

              <div className="flex flex-col gap-2 border border-border p-6 bg-muted/20">
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                  [ DAY STATS / 序数 ]
                </span>
                <span className="font-mono text-sm text-foreground">
                  当年第 <strong className="text-primary font-bold">{result.stats?.day_of_year || '--'}</strong> 天 / 第{' '}
                  <strong className="text-primary font-bold">{result.stats?.week_of_year || '--'}</strong> 周
                </span>
              </div>
            </div>

            {/* 宜与忌 */}
            {(getYiList().length > 0 || getJiList().length > 0) && (
              <div className="gsap-reveal grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-border pt-8">
                {/* 宜 */}
                <div className="flex flex-col gap-4 border border-status-success-foreground/20 bg-status-success-surface/30 p-6">
                  <div className="flex items-center justify-between border-b border-status-success-foreground/20 pb-3">
                    <span className="font-mono text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-status-success-foreground">
                      [ YI / 宜 ]
                    </span>
                    <Moon className="h-4 w-4 text-status-success-foreground" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {getYiList().length > 0 ? (
                      getYiList().map((item, idx) => (
                        <span
                          key={`yi-${item}-${idx}`}
                          className="bg-status-success-surface border border-status-success-foreground/30 px-3 py-1 font-mono text-xs font-bold text-status-success-foreground"
                        >
                          {item}
                        </span>
                      ))
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">诸事不宜</span>
                    )}
                  </div>
                </div>

                {/* 忌 */}
                <div className="flex flex-col gap-4 border border-status-danger-foreground/20 bg-status-danger-surface/30 p-6">
                  <div className="flex items-center justify-between border-b border-status-danger-foreground/20 pb-3">
                    <span className="font-mono text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-status-danger-foreground">
                      [ JI / 忌 ]
                    </span>
                    <WarningCircle className="h-4 w-4 text-status-danger-foreground" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {getJiList().length > 0 ? (
                      getJiList().map((item, idx) => (
                        <span
                          key={`ji-${item}-${idx}`}
                          className="bg-status-danger-surface border border-status-danger-foreground/30 px-3 py-1 font-mono text-xs font-bold text-status-danger-foreground"
                        >
                          {item}
                        </span>
                      ))
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">百无禁忌</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 下个假期 & 倒计时 */}
            <div className="gsap-reveal grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* 下个假期 Highlight */}
              {result.nextHoliday && (
                <div className="lg:col-span-5 flex flex-col justify-between border border-primary bg-primary/5 p-8 relative overflow-hidden">
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-primary font-bold">
                      [ NEXT HOLIDAY / 下一个节假日 ]
                    </span>
                    <h3 className="font-heading text-3xl font-bold text-foreground mt-2 break-words">
                      {result.nextHoliday.name}
                    </h3>
                    <p className="font-mono text-xs text-muted-foreground break-words">
                      假期日期: {result.nextHoliday.date} ({result.nextHoliday.duration} 天)
                    </p>
                  </div>

                  <div className="mt-8 flex items-baseline gap-2">
                    <span className="font-mono text-xs text-muted-foreground">距离还有</span>
                    <span className="font-mono text-5xl font-bold text-primary">
                      {result.nextHoliday.until}
                    </span>
                    <span className="font-mono text-sm text-muted-foreground">天</span>
                  </div>
                </div>
              )}

              {/* 4 项倒计时 */}
              <div className={`${result.nextHoliday ? 'lg:col-span-7' : 'lg:col-span-12'} grid grid-cols-2 sm:grid-cols-4 gap-4`}>
                <div className="flex flex-col gap-2 border border-border p-6 bg-muted/20">
                  <span className="font-mono text-xs text-muted-foreground">距离周末</span>
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-bold text-foreground">
                      {result.countdown?.toWeekEnd ?? '--'}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">天</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border border-border p-6 bg-muted/20">
                  <span className="font-mono text-xs text-muted-foreground">距离周五</span>
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-bold text-foreground">
                      {result.countdown?.toFriday ?? '--'}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">天</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border border-border p-6 bg-muted/20">
                  <span className="font-mono text-xs text-muted-foreground">距离月底</span>
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-bold text-foreground">
                      {result.countdown?.toMonthEnd ?? '--'}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">天</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border border-border p-6 bg-muted/20">
                  <span className="font-mono text-xs text-muted-foreground">距离年底</span>
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-bold text-foreground">
                      {result.countdown?.toYearEnd ?? '--'}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">天</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 摸鱼进度条 */}
            {result.progress && (
              <div className="gsap-reveal flex flex-col gap-6 border-t border-border pt-8">
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                  [ TIME PROGRESS / 摸鱼进度条 ]
                </span>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {/* 本周进度 */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-muted-foreground">本周进度</span>
                      <span className="font-bold text-foreground">{result.progress.week?.percentage ?? 0}%</span>
                    </div>
                    <div className="h-3 w-full bg-muted overflow-hidden border border-border">
                      <div
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, result.progress.week?.percentage ?? 0))}%` }}
                      />
                    </div>
                  </div>

                  {/* 本月进度 */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-muted-foreground">本月进度</span>
                      <span className="font-bold text-foreground">{result.progress.month?.percentage ?? 0}%</span>
                    </div>
                    <div className="h-3 w-full bg-muted overflow-hidden border border-border">
                      <div
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, result.progress.month?.percentage ?? 0))}%` }}
                      />
                    </div>
                  </div>

                  {/* 今年进度 */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-muted-foreground">今年进度</span>
                      <span className="font-bold text-foreground">{result.progress.year?.percentage ?? 0}%</span>
                    </div>
                    <div className="h-3 w-full bg-muted overflow-hidden border border-border">
                      <div
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, result.progress.year?.percentage ?? 0))}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 摸鱼金句 */}
            {result.moyuQuote && (
              <div className="gsap-reveal border border-border bg-muted/30 p-8 relative flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <Quotes className="h-6 w-6 text-primary" />
                  <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-primary font-bold">
                    [ MOYU QUOTE / 摸鱼金句 ]
                  </span>
                </div>
                <p className="font-mono text-base md:text-lg italic text-foreground leading-relaxed pl-2 break-words">
                  "{result.moyuQuote}"
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CalendarTool;
