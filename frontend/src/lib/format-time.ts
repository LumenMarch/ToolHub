/**
 * 全站统一的时间解析与格式化工具。
 *
 * 背景：后端 FastAPI 序列化的 datetime 为无时区 UTC（naive UTC，
 * 如 "2026-08-10T06:18:05.777760"，不带 Z 后缀）。若直接 new Date(value)，
 * 该字符串会被按浏览器本地时区解析，等于把 UTC 时刻当成本地时刻显示
 * （东八区会差 8 小时）。这里统一解析策略：无时区后缀的字符串按 UTC 补 'Z'
 * 解析为真实时刻；展示一律走本地时区 getFullYear / toLocale* 方法，
 * 保证显示跟随当前系统时区（浏览器本地时区）。
 */

/** 解析后端时间值为 Date。兼容无时区 UTC 字符串 / 带时区字符串 / epoch 毫秒数字。
 *  解析失败或空值返回 null，调用方按需兜底。 */
export function parseServerDate(
  value: string | number | Date | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // epoch 毫秒时间戳为绝对时刻，直接构造。
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // 无时区后缀视为 UTC（后端 naive UTC 约定），补 Z 避免按本地时区误读。
  const hasTimezone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const d = new Date(hasTimezone ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'YYYY/MM/DD HH:mm:ss'（本地时区，zh-CN 风格，对齐现有页面）。无效值返回 ''。 */
export function formatDateTime(
  value: string | number | Date | null | undefined,
): string {
  const date = parseServerDate(value);
  if (!date) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** 'HH:mm'（本地时区，用于过期时间等短时展示）。无效值返回 ''。 */
export function formatTime(
  value: string | number | Date | null | undefined,
): string {
  const date = parseServerDate(value);
  if (!date) return '';
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
