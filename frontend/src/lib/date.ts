import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i

/**
 * 后端历史接口返回 naive UTC（无时区后缀），直接交给 dayjs 会按本地时间解析。
 * 这里把缺少时区的服务端时间显式按 UTC 处理。
 */
export function parseServerDate(value: string): Dayjs {
  const trimmed = value.trim()
  return dayjs(HAS_TIMEZONE.test(trimmed) ? trimmed : `${trimmed}Z`)
}
