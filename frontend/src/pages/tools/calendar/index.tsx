import { useState } from 'react'
import { Calendar, CircleAlert, Moon, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

import api from '@/api/axios'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

interface SixtyCycleItem {
  name?: string
  heaven_stem?: string
  earth_branch?: string
}

interface CalendarResult {
  // lunar 块
  solar?: {
    year?: number
    month?: number
    day?: number
    full?: string
    week_desc?: string
    season_desc?: string
    is_leap_year?: boolean
  }
  lunar?: {
    desc_short?: string
    year_desc?: string
    month_desc?: string
    day_desc?: string
    hour_desc?: string
    is_leap_month?: boolean
  }
  stats?: {
    day_of_year?: number
    week_of_year?: number
    week_of_month?: number
  }
  term?: {
    today?: string | null
    stage?: {
      name?: string
      position?: string
      is_jie?: boolean
      is_qi?: boolean
    }
  }
  zodiac?:
    | {
        year?: string
        month?: string
        day?: string
        hour?: string
      }
    | string
  sixty_cycle?: {
    year?: SixtyCycleItem
    month?: SixtyCycleItem
    day?: SixtyCycleItem
    hour?: SixtyCycleItem
  }
  taboo?: {
    day?: {
      recommends?: string
      avoids?: string
    }
    hour?: {
      hour?: string
      hour_short?: string
      recommends?: string
      avoids?: string
    }
    hours?: Array<{
      hour?: string
      hour_short?: string
      recommends?: string
      avoids?: string
    }>
  }
  constellation?: {
    name?: string
    name_short?: string
  }
  phase?: {
    name?: string
    position?: number
  }
  nayin?: {
    year?: string
    month?: string
    day?: string
    hour?: string
  }
  baizi?: {
    year_baizi?: string
    day_baizi?: string
  }
  fortune?: {
    today_luck?: string
    career?: string
    money?: string
    love?: string
  }
  festival?: {
    solar?: string | null
    lunar?: string | null
    both_desc?: string | null
  }
  // moyu 块
  date?: {
    gregorian?: string
    weekday?: string
    dayOfWeek?: number
    lunar?: {
      yearCN?: string
      monthCN?: string
      dayCN?: string
      zodiac?: string
      yearGanZhi?: string
      monthGanZhi?: string
      dayGanZhi?: string
    }
  }
  today?: {
    isWeekend?: boolean
    isHoliday?: boolean
    holidayName?: string | null
    solarTerm?: string
    lunarFestivals?: string[]
    isWorkday?: boolean
  }
  currentHoliday?: {
    name?: string
    dayOfHoliday?: number
    daysRemaining?: number
  } | null
  nextHoliday?: {
    name?: string
    date?: string
    duration?: number
    until?: number
    workdays?: string[]
  } | null
  countdown?: {
    toWeekEnd?: number
    toFriday?: number
    toMonthEnd?: number
    toYearEnd?: number
  }
  progress?: {
    week?: { percentage?: number }
    month?: { percentage?: number }
    year?: { percentage?: number }
  }
  moyuQuote?: string
}

const getTodayString = (): string => {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const ProgressBar: React.FC<{ label: string; value: number }> = ({
  label,
  value,
}) => {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

const CalendarTool: React.FC = () => {
  const [dateInput, setDateInput] = useState<string>(getTodayString())
  const [queryDate, setQueryDate] = useState<string>(getTodayString())

  const query = useQuery({
    queryKey: ['calendar', queryDate],
    queryFn: async ({ signal }) => {
      const res = await api.post<{ result: CalendarResult }>(
        '/tools/calendar/info',
        { date: queryDate || undefined },
        { signal },
      )
      return res.data.result
    },
  })

  const loading = query.isPending || query.isFetching
  const error =
    !query.isError || query.isFetching
      ? ''
      : axios.isAxiosError(query.error)
        ? query.error.response?.data?.detail || '系统发生错误'
        : '系统发生错误'
  const result = query.data ?? null

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault()
    if (dateInput === queryDate) {
      void query.refetch()
    } else {
      setQueryDate(dateInput)
    }
  }

  const handleSetToday = () => {
    const today = getTodayString()
    setDateInput(today)
    if (today === queryDate) {
      void query.refetch()
    } else {
      setQueryDate(today)
    }
  }

  const renderStatusBadge = () => {
    if (!result?.today) return null
    const { isHoliday, isWeekend, isWorkday, holidayName } = result.today

    if (isHoliday) {
      return <Badge>节假日：{holidayName || '休假'}</Badge>
    }
    if (isWeekend) {
      return <Badge variant="secondary">周末休假</Badge>
    }
    if (isWorkday) {
      return <Badge variant="outline">工作日</Badge>
    }
    return null
  }

  const getStatusTitle = () => {
    if (!result?.today) return '今日日历'
    const { isHoliday, isWeekend, holidayName } = result.today
    if (isHoliday) return `今天是 节假日 (${holidayName || '休假'})`
    if (isWeekend) return '今天是 周末双休'
    return '今天是 工作日'
  }

  const getYiList = (): string[] => {
    const raw = result?.taboo?.day?.recommends
    if (!raw) return []
    return raw.split(/[.\s,，]+/).filter(Boolean)
  }

  const getJiList = (): string[] => {
    const raw = result?.taboo?.day?.avoids
    if (!raw) return []
    return raw.split(/[.\s,，]+/).filter(Boolean)
  }

  const getZodiacText = (): string => {
    if (!result?.zodiac) return '--'
    if (typeof result.zodiac === 'string') return result.zodiac
    return result.zodiac.year ? `生肖${result.zodiac.year}` : '--'
  }

  const lunarTitle =
    result?.lunar?.desc_short ||
    `${result?.lunar?.year_desc || ''} ${result?.lunar?.month_desc || ''}${result?.lunar?.day_desc || ''}`

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>查询</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleQuery}>
            <FieldGroup>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <Field
                  className="sm:max-w-xs"
                  data-invalid={Boolean(error) || undefined}
                >
                  <FieldLabel htmlFor="calendar-date-input">查询日期</FieldLabel>
                  <Input
                    type="date"
                    id="calendar-date-input"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    aria-invalid={Boolean(error)}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={handleSetToday}>
                    <Calendar data-icon="inline-start" />
                    今天
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Search data-icon="inline-start" />
                    )}
                    {loading ? '查询中' : '查询日历'}
                  </Button>
                </div>
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {loading && !result ? (
        <Card>
          <CardContent className="flex min-h-72 items-center justify-center">
            <Spinner />
          </CardContent>
        </Card>
      ) : result ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{getStatusTitle()}</CardTitle>
                {renderStatusBadge()}
              </div>
              <CardDescription>
                公历 {result.date?.gregorian} · {result.date?.weekday}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {result.currentHoliday ? (
                <Alert>
                  <AlertDescription>
                    正在休假中：{result.currentHoliday.name}（第{' '}
                    {result.currentHoliday.dayOfHoliday} 天，剩余{' '}
                    {result.currentHoliday.daysRemaining} 天）
                  </AlertDescription>
                </Alert>
              ) : null}
              <p className="text-3xl font-semibold tracking-tight break-words">
                {lunarTitle}
              </p>
              {result.solar?.season_desc ? (
                <p className="text-sm text-muted-foreground">
                  {result.solar.season_desc}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {result.sixty_cycle ? (
            <Card>
              <CardHeader>
                <CardTitle>干支历法</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">年柱</span>
                    <span className="text-lg font-semibold">
                      {result.sixty_cycle.year?.name || '--'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">月柱</span>
                    <span className="text-lg font-semibold">
                      {result.sixty_cycle.month?.name || '--'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">日柱</span>
                    <span className="text-lg font-semibold">
                      {result.sixty_cycle.day?.name || '--'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">时柱</span>
                    <span className="text-lg font-semibold">
                      {result.sixty_cycle.hour?.name || '--'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>生肖星座</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium break-words">
                  {getZodiacText()}
                  {result.constellation?.name
                    ? ` · ${result.constellation.name}`
                    : ''}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>节气</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">
                  {result.term?.today || result.term?.stage?.name || '无节气'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>序数</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">
                  当年第{' '}
                  <span className="font-semibold tabular-nums">
                    {result.stats?.day_of_year || '--'}
                  </span>{' '}
                  天 / 第{' '}
                  <span className="font-semibold tabular-nums">
                    {result.stats?.week_of_year || '--'}
                  </span>{' '}
                  周
                </p>
              </CardContent>
            </Card>
          </div>

          {getYiList().length > 0 || getJiList().length > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>宜</CardTitle>
                    <Moon className="size-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {getYiList().length > 0 ? (
                      getYiList().map((item) => (
                        <Badge
                          key={`yi-${item}`}
                          variant="secondary"
                        >
                          {item}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        诸事不宜
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>忌</CardTitle>
                    <CircleAlert className="size-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {getJiList().length > 0 ? (
                      getJiList().map((item) => (
                        <Badge
                          key={`ji-${item}`}
                          variant="destructive"
                        >
                          {item}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        百无禁忌
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {result.nextHoliday ? (
              <Card className="lg:col-span-5">
                <CardHeader>
                  <CardTitle>下一个节假日</CardTitle>
                  <CardDescription>
                    {result.nextHoliday.date} · {result.nextHoliday.duration} 天
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="text-3xl font-semibold tracking-tight break-words">
                    {result.nextHoliday.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    距离还有{' '}
                    <span className="text-foreground font-semibold tabular-nums">
                      {result.nextHoliday.until}
                    </span>{' '}
                    天
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <div
              className={`${result.nextHoliday ? 'lg:col-span-7' : 'lg:col-span-12'} grid grid-cols-2 gap-4 sm:grid-cols-4`}
            >
              {(
                [
                  ['距离周末', result.countdown?.toWeekEnd],
                  ['距离周五', result.countdown?.toFriday],
                  ['距离月底', result.countdown?.toMonthEnd],
                  ['距离年底', result.countdown?.toYearEnd],
                ] as const
              ).map(([label, value]) => (
                <Card key={label} size="sm">
                  <CardHeader>
                    <CardDescription>{label}</CardDescription>
                    <CardTitle className="flex items-baseline gap-1 text-2xl font-semibold">
                      <span className="tabular-nums">{value ?? '--'}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        天
                      </span>
                    </CardTitle>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>

          {result.progress ? (
            <Card>
              <CardHeader>
                <CardTitle>时间进度</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  <ProgressBar
                    label="本周进度"
                    value={result.progress.week?.percentage ?? 0}
                  />
                  <ProgressBar
                    label="本月进度"
                    value={result.progress.month?.percentage ?? 0}
                  />
                  <ProgressBar
                    label="今年进度"
                    value={result.progress.year?.percentage ?? 0}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="flex min-h-72 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>等待查询</EmptyTitle>
                <EmptyDescription>
                  选择日期后查看农历与假期信息。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default CalendarTool
