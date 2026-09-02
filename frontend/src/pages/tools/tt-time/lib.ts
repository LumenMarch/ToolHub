import Papa from 'papaparse';

/**
 * TT 时间计算 — 数据解析与统计（纯函数，便于单元验证）。
 *
 * 输入 CSV 来自测试工站导出（如 Export-ID-*.csv），结构约定：
 * - 文件头若干行为元数据（标题 / 列头 / Display Name / PDCA 等）；
 * - 含 "Station ID" 的那一行是真实列头；
 * - 数据行：Station ID、StartTime、EndTime 均非空才视为有效。
 * 测试时间 = EndTime − StartTime，单位秒。
 */

export interface TestRow {
  /** 机台 ID（Station ID 列） */
  stationId: string;
    /** 测试时间（秒，EndTime − StartTime） */
  tt: number;
}

export interface ParseResult {
  rows: TestRow[];
  /** 被跳过的元数据/无效行数 */
  skipped: number;
  /** 解析失败（时间格式非法或 TT 非正）的行数 */
  invalid: number;
}

export interface Stats {
  count: number;
  min: number;
  max: number;
  q1: number;
  /** 中位数（Q2） */
  q2: number;
  q3: number;
}

export interface Bin {
  label: string;
  /** 桶下界（秒，含） */
  lo: number;
  /** 桶上界（秒，不含；最后一桶含） */
  hi: number;
  count: number;
  /** 占比（0-100） */
  percent: number;
}

/**
 * 匹配本地时间串：YYYY/M/D 或 YYYY-MM-DD，时间部分 H:mm[:ss[.fff]]。
 * 兼容旧导出（斜杠、无秒）与新导出（短线、带秒/毫秒）。
 */
const TIME_RE =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/** 手动解析本地时间，避免 Safari 对非 ISO 字符串 Date.parse 兼容性问题 */
export const parseTestTimestamp = (raw: string): number => {
  const m = TIME_RE.exec(raw.trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, sec, ms] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec ?? 0),
    Number((ms ?? '').padEnd(3, '0') || 0),
  ).getTime();
};

/** 解析测试日志 CSV，返回有效测试行与统计 */
export const parseTestRows = (text: string): ParseResult => {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
  });
  const grid = result.data;
  if (grid.length === 0) {
    return { rows: [], skipped: 0, invalid: 0 };
  }

  // 定位真实列头行（含 Station ID 的那一行）
  let headerIdx = -1;
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    if (grid[i].some((cell) => String(cell).trim() === 'Station ID')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    return { rows: [], skipped: grid.length, invalid: 0 };
  }

  const header = grid[headerIdx].map((c) => String(c).trim());
  const stationCol = header.indexOf('Station ID');
  const startCol = header.indexOf('StartTime');
  const endCol = header.indexOf('EndTime');
  if (stationCol < 0 || startCol < 0 || endCol < 0) {
    return { rows: [], skipped: grid.length, invalid: 0 };
  }

  const rows: TestRow[] = [];
  let invalid = 0;
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i];
    const station = cells[stationCol]?.trim() ?? '';
    const startRaw = cells[startCol]?.trim() ?? '';
    const endRaw = cells[endCol]?.trim() ?? '';
    // 元数据行（PDCA / Upper Limit 等）只有首列有值，直接跳过
    if (!station || !startRaw || !endRaw) continue;
    const start = parseTestTimestamp(startRaw);
    const end = parseTestTimestamp(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      invalid++;
      continue;
    }
    const tt = (end - start) / 1000;
    if (!(tt > 0)) {
      invalid++;
      continue;
    }
    rows.push({ stationId: station, tt });
  }
  return { rows, skipped: headerIdx, invalid };
};

/** 线性插值分位数（PERCENTILE.INC 语义），输入需已排序 */
const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return NaN;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
};

/** 计算五数总结（min / max / Q1 / Q2 / Q3），结果保留三位小数 */
export const computeStats = (tts: number[]): Stats => {
  if (tts.length === 0) {
    return { count: 0, min: NaN, max: NaN, q1: NaN, q2: NaN, q3: NaN };
  }
  const sorted = tts.toSorted((a, b) => a - b);
  const round3 = (v: number): number => Number(v.toFixed(3));
  return {
    count: tts.length,
    min: round3(sorted[0]),
    max: round3(sorted[sorted.length - 1]),
    q1: round3(percentile(sorted, 0.25)),
    q2: round3(percentile(sorted, 0.5)),
    q3: round3(percentile(sorted, 0.75)),
  };
};

/** 时间显示格式化：最多 1 位小数，整数不带尾零 */
const fmtSeconds = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toFixed(1);

/**
 * 按固定桶宽分箱（秒）。桶从 min 向下取整到桶宽整数倍开始，
 * 到 max 向上取整结束；最后一桶闭区间。
 * 标签：桶宽为 1 时用单值（180S），否则用区间（180-181 S）。
 */
export const binByWidth = (tts: number[], widthSeconds: number): Bin[] => {
  if (tts.length === 0 || !(widthSeconds > 0)) return [];
  const total = tts.length;
  const min = Math.min(...tts);
  const max = Math.max(...tts);
  const lo0 = Math.floor(min / widthSeconds) * widthSeconds;
  const hiN = Math.ceil(max / widthSeconds) * widthSeconds;
  const binCount = Math.max(1, Math.ceil((hiN - lo0) / widthSeconds));
  const bins: Bin[] = [];
  for (let i = 0; i < binCount; i++) {
    const lo = lo0 + i * widthSeconds;
    const hi = lo + widthSeconds;
    let count = 0;
    for (const t of tts) {
      if (t >= lo && (i === binCount - 1 ? t <= hi : t < hi)) count++;
    }
    bins.push({
      label:
        widthSeconds === 1
          ? `${fmtSeconds(lo)}S`
          : `${fmtSeconds(lo)}–${fmtSeconds(hi)} S`,
      lo,
      hi,
      count,
      percent: (count / total) * 100,
    });
  }
  // 丢弃空桶，避免横向柱子出现空隙
  return bins.filter((b) => b.count > 0);
};

export interface CdfPoint {
  /** 测试时间（秒） */
  x: number;
  /** 累计占比（0-100） */
  y: number;
}

/** 累计分布曲线（CDF）：x = 测试时间，y = 小于等于 x 的累计占比 */
export const cdfPoints = (tts: number[]): CdfPoint[] => {
  if (tts.length === 0) return [];
  const sorted = tts.toSorted((a, b) => a - b);
  const n = sorted.length;
  const points: CdfPoint[] = [];
  // 起点：最小值之前累计为 0（阶梯线从 0 抬升）
  points.push({ x: sorted[0], y: 0 });
  let i = 0;
  while (i < n) {
    const v = sorted[i];
    let j = i;
    while (j < n && sorted[j] === v) j++;
    points.push({ x: v, y: (j / n) * 100 });
    i = j;
  }
  return points;
};

/** 单台机台的样本条数（用于 LLM 机台对比） */
export interface AnalysisStationCount {
  id: string;
  count: number;
}

/**
 * 发送给后端做 LLM 分析的结构化上下文。
 * 只含统计结果与关键百分位，不含原始 CSV 数据。
 */
export interface AnalysisContext {
  fileName: string;
  stationFilter: string;
  totalRows: number;
  stats: Stats;
  distribution: { label: string; count: number; percent: number }[];
  percentiles: { p50: number; p90: number; p95: number; p99: number };
  /** 基于真实样本算出的长尾统计（Q3+1.5×IQR 阈值与超过它的真实占比） */
  tail: {
    iqrThreshold: number;
    outlierCount: number;
    outlierPercent: number;
  };
  stations: AnalysisStationCount[];
}

/**
 * 把当前筛选下的统计结果组装成 LLM 分析上下文。
 * 额外计算 p50/p90/p95/p99，给 4B 模型更可靠的离群信号。
 */
export const buildAnalysisContext = (args: {
  fileName: string;
  stationFilter: string;
  tts: number[];
  stats: Stats;
  bins: Bin[];
  stations: string[];
  stationTtMap?: Record<string, number[]>;
}): AnalysisContext => {
  const { fileName, stationFilter, tts, stats, bins, stations } = args;
  const sorted = tts.toSorted((a, b) => a - b);
  const pct = (p: number) => {
    if (sorted.length === 0) return 0;
    const v = percentile(sorted, p);
    return Number.isFinite(v) ? Number(v.toFixed(1)) : 0;
  };

  const stationCounts: AnalysisStationCount[] = [];
  for (const id of stations) {
    const list = args.stationTtMap?.[id] ?? [];
    if (list.length > 0) stationCounts.push({ id, count: list.length });
  }

  // 基于真实样本计算长尾统计：超过 Q3+1.5×IQR 的样本条数与占比
  // 由前端从原始 tts 精确算出，模型据此引用，避免 4B 自行拆分区间、编造占比。
  let iqrThreshold = 0;
  let outlierCount = 0;
  let outlierPercent = 0;
  if (tts.length > 0) {
    const iqr = (stats.q3 ?? 0) - (stats.q1 ?? 0);
    iqrThreshold = Number(((stats.q3 ?? 0) + 1.5 * iqr).toFixed(1));
    outlierCount = tts.filter((t) => t > iqrThreshold).length;
    outlierPercent = Number(((outlierCount / tts.length) * 100).toFixed(1));
  }

  return {
    fileName,
    stationFilter,
    totalRows: tts.length,
    stats,
    distribution: bins.map((b) => ({
      label: b.label,
      count: b.count,
      percent: Number(b.percent.toFixed(1)),
    })),
    percentiles: { p50: pct(0.5), p90: pct(0.9), p95: pct(0.95), p99: pct(0.99) },
    tail: { iqrThreshold, outlierCount, outlierPercent },
    stations: stationCounts,
  };
};
