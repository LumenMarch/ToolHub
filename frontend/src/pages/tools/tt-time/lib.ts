import Papa from 'papaparse';
import * as XLSX from 'xlsx';

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
  /** 测试状态（Test Pass/Fail Status 列，如 PASS / FAIL / 空） */
  status?: string;
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

export interface StationBoxGroup {
  stationId: string;
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
}

/** 按照 Station ID 计算每个机台的箱线图统计指标（包含 Tukey 离群点） */
export const computeStationBoxGroups = (
  rows: TestRow[],
): StationBoxGroup[] => {
  const stationMap: Record<string, number[]> = {};
  for (const r of rows) {
    (stationMap[r.stationId] ||= []).push(r.tt);
  }
  const sortedStations = Object.keys(stationMap).sort((a, b) => {
    const numStrA = formatStationNumericName(a);
    const numStrB = formatStationNumericName(b);
    const numA = parseInt(numStrA, 10);
    const numB = parseInt(numStrB, 10);
    const isNumA = Number.isFinite(numA) && /^\d+$/.test(numStrA);
    const isNumB = Number.isFinite(numB) && /^\d+$/.test(numStrB);

    if (isNumA && isNumB && numA !== numB) {
      return numA - numB;
    }
    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;

    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });

  const groups: StationBoxGroup[] = [];
  for (const stationId of sortedStations) {
    const vals = stationMap[stationId];
    if (!vals || vals.length === 0) continue;
    const sorted = vals.toSorted((a, b) => a - b);
    const n = sorted.length;
    const min = sorted[0];
    const max = sorted[n - 1];
    const q1 = percentile(sorted, 0.25);
    const median = percentile(sorted, 0.5);
    const q3 = percentile(sorted, 0.75);
    const iqr = q3 - q1;
    const fenceLow = q1 - 1.5 * iqr;
    const fenceHigh = q3 + 1.5 * iqr;

    const inliers = sorted.filter((v) => v >= fenceLow && v <= fenceHigh);
    const whiskerLow = inliers.length > 0 ? inliers[0] : min;
    const whiskerHigh = inliers.length > 0 ? inliers[inliers.length - 1] : max;
    const outliers = sorted.filter((v) => v < fenceLow || v > fenceHigh);

    groups.push({
      stationId,
      count: n,
      min: Number(min.toFixed(1)),
      q1: Number(q1.toFixed(1)),
      median: Number(median.toFixed(1)),
      q3: Number(q3.toFixed(1)),
      max: Number(max.toFixed(1)),
      iqr: Number(iqr.toFixed(1)),
      whiskerLow: Number(whiskerLow.toFixed(1)),
      whiskerHigh: Number(whiskerHigh.toFixed(1)),
      outliers: outliers.map((v) => Number(v.toFixed(1))),
    });
  }
  return groups;
};

/**
 * 匹配本地时间串：YYYY/M/D 或 YYYY-MM-DD，时间部分 H:mm[:ss[.fff]]。
 * 兼容旧导出（斜杠、无秒）与新导出（短线、带秒/毫秒）。
 */
const TIME_RE =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/** 手动解析本地时间，兼容字符串、Date 对象及 Excel 日期 */
export const parseTestTimestamp = (raw: unknown): number => {
  if (raw == null) return NaN;
  if (raw instanceof Date) {
    return raw.getTime();
  }
  if (typeof raw === 'number') {
    // Excel 序列号日期 (1900 日期系统，例如 25569 对应 1970-01-01)
    if (raw > 25569 && raw < 100000) {
      return Math.round((raw - 25569) * 86400 * 1000);
    }
    // Unix 毫秒时间戳
    if (raw > 1000000000000) return raw;
    // Unix 秒时间戳
    if (raw > 1000000000) return raw * 1000;
  }
  const str = String(raw).trim();
  const m = TIME_RE.exec(str);
  if (m) {
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
  }
  const parsed = Date.parse(str);
  return Number.isFinite(parsed) ? parsed : NaN;
};

/** 解析测试日志网格数据（通用二维数组） */
export const parseTestGrid = (grid: unknown[][]): ParseResult => {
  if (!grid || grid.length === 0) {
    return { rows: [], skipped: 0, invalid: 0 };
  }

  // 定位真实列头行（含 Station ID 的那一行）
  let headerIdx = -1;
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const row = grid[i];
    if (
      Array.isArray(row) &&
      row.some((cell) => String(cell ?? '').trim() === 'Station ID')
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    return { rows: [], skipped: grid.length, invalid: 0 };
  }

  const header = (grid[headerIdx] || []).map((c) => String(c ?? '').trim());
  const stationCol = header.indexOf('Station ID');
  const startCol = header.indexOf('StartTime');
  const endCol = header.indexOf('EndTime');
  const statusCol = header.indexOf('Test Pass/Fail Status');
  if (stationCol < 0 || startCol < 0 || endCol < 0) {
    return { rows: [], skipped: grid.length, invalid: 0 };
  }

  const rows: TestRow[] = [];
  let invalid = 0;
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells) continue;
    const station = String(cells[stationCol] ?? '').trim();
    const startRaw = cells[startCol];
    const endRaw = cells[endCol];
    const status =
      statusCol >= 0 && cells[statusCol] != null
        ? String(cells[statusCol]).trim()
        : undefined;
    // 元数据行（PDCA / Upper Limit 等）只有首列有值，直接跳过
    if (
      !station ||
      startRaw == null ||
      endRaw == null ||
      String(startRaw).trim() === '' ||
      String(endRaw).trim() === ''
    ) {
      continue;
    }
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
    rows.push({ stationId: station, tt, status });
  }
  return { rows, skipped: headerIdx, invalid };
};

/** 解析测试日志 CSV 文本，返回有效测试行与统计 */
export const parseTestRows = (text: string): ParseResult => {
  const result = Papa.parse<unknown[]>(text, {
    skipEmptyLines: 'greedy',
  });
  return parseTestGrid(result.data);
};

/** 解析 Excel (XLSX / XLS) 二进制缓冲，返回有效测试行与统计 */
export const parseExcelBuffer = (
  buffer: ArrayBuffer | Uint8Array | number[],
): ParseResult => {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], skipped: 0, invalid: 0 };
  }
  const sheet = wb.Sheets[firstSheetName];
  if (!sheet) {
    return { rows: [], skipped: 0, invalid: 0 };
  }
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });
  return parseTestGrid(grid);
};

/** 统一根据文件类型自动解析 CSV、XLSX 或 XLS 文件 */
export const parseTestFile = async (file: File): Promise<ParseResult> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    return parseExcelBuffer(buf);
  }
  try {
    const text = await file.text();
    const res = parseTestRows(text);
    if (res.rows.length > 0) return res;
  } catch {
    // text 读取失败尝试二进制解析
  }
  try {
    const buf = await file.arrayBuffer();
    return parseExcelBuffer(buf);
  } catch {
    return { rows: [], skipped: 0, invalid: 0 };
  }
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

/** 累计分布曲线（CDF）：基于百分位采样生成平滑曲线点集 */
export const cdfPoints = (tts: number[]): CdfPoint[] => {
  if (tts.length === 0) return [];
  const sorted = tts.toSorted((a, b) => a - b);
  const n = sorted.length;
  const minVal = sorted[0];
  const maxVal = sorted[n - 1];

  const points: CdfPoint[] = [];
  points.push({ x: minVal, y: 0 });

  const numSamples = Math.min(200, Math.max(20, n));
  for (let i = 1; i < numSamples; i++) {
    const p = i / numSamples;
    const tAtP = Number(percentile(sorted, p).toFixed(2));
    const pctVal = Number((p * 100).toFixed(1));
    if (points.length > 0 && points[points.length - 1].x === tAtP) {
      points[points.length - 1] = { x: tAtP, y: pctVal };
    } else {
      points.push({ x: tAtP, y: pctVal });
    }
  }

  if (points[points.length - 1].x === maxVal) {
    points[points.length - 1] = { x: maxVal, y: 100 };
  } else {
    points.push({ x: maxVal, y: 100 });
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
  stats: Stats & { mean: number };
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

  const mean =
    tts.length > 0
      ? Number((tts.reduce((sum, t) => sum + t, 0) / tts.length).toFixed(3))
      : 0;

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
    stats: { ...stats, mean },
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

/**
 * 将机台名称精准提取并格式化为只带数字的形式。
 * 适配场景：
 * 1. 纯数字："15", "01" -> "15", "1"
 * 2. 复合工站名称独立数字段：如 "FLDG_FQ3-4FT-01B_15_HILO1" -> "15"
 * 3. 常见机台前缀："ST01", "Station-48", "Slot_2" -> "1", "48", "2"
 * 4. 纯非数字机台名称：保留原样
 */
export const formatStationNumericName = (stationId: string): string => {
  const trimmed = stationId.trim();
  if (!trimmed) return '';

  // 1. 本身即为纯数字
  if (/^\d+$/.test(trimmed)) {
    return String(parseInt(trimmed, 10));
  }

  // 2. 优先按下划线、斜杠、空格等分段，寻找完全由纯数字构成的独立分段
  // 例如 FLDG_FQ3-4FT-01B_15_HILO1 中有独立分段 "15"
  const segments = trimmed.split(/[_/\\|:,\s]+/);
  const pureNumSegments = segments.filter((s) => /^\d+$/.test(s));

  if (pureNumSegments.length === 1) {
    return String(parseInt(pureNumSegments[0], 10));
  }

  if (pureNumSegments.length > 1) {
    // 过滤掉明显的 4 位年份 (如 2024/2025/2026) 或超长时间戳
    const nonYear = pureNumSegments.filter(
      (s) => !(s.length === 4 && (s.startsWith('20') || s.startsWith('19'))),
    );
    if (nonYear.length > 0) {
      return String(parseInt(nonYear[nonYear.length - 1], 10));
    }
    return String(parseInt(pureNumSegments[0], 10));
  }

  // 3. 匹配常见机台前缀后紧随的数字，例如 ST01, ST-15, Station_2, Slot4
  const prefixMatch = trimmed.match(
    /(?:ST|Station|Unit|Pos|Slot|#|No|机台)[-_ ]*(\d+)/i,
  );
  if (prefixMatch && prefixMatch[1]) {
    return String(parseInt(prefixMatch[1], 10));
  }

  // 4. 匹配独立单词边界的数字，例如 "Station 15", "Line 2"
  const wordMatch = trimmed.match(/\b(\d+)\b/);
  if (wordMatch && wordMatch[1]) {
    return String(parseInt(wordMatch[1], 10));
  }

  // 5. 兜底提取字符串中出现的独立数字
  const allNumMatches = trimmed.match(/\d+/g);
  if (allNumMatches && allNumMatches.length > 0) {
    return String(parseInt(allNumMatches[allNumMatches.length - 1], 10));
  }

  // 6. 无任何数字时保留原样
  return trimmed;
};

export interface StationComparisonTableRow {
  label: '最大值' | 'Q3' | 'Med' | 'Q1' | '最小值';
  values: Record<string, number>;
}

export interface StationComparisonTable {
  stations: string[];
  rows: StationComparisonTableRow[];
}

/** 构造机台数据对比的五数表格数据（最大值、Q3、Med、Q1、最小值） */
export const buildStationComparisonTable = (
  groups: StationBoxGroup[],
): StationComparisonTable => {
  const stations = groups.map((g) => g.stationId);
  const maxRow: StationComparisonTableRow = { label: '最大值', values: {} };
  const q3Row: StationComparisonTableRow = { label: 'Q3', values: {} };
  const medRow: StationComparisonTableRow = { label: 'Med', values: {} };
  const q1Row: StationComparisonTableRow = { label: 'Q1', values: {} };
  const minRow: StationComparisonTableRow = { label: '最小值', values: {} };

  for (const g of groups) {
    maxRow.values[g.stationId] = g.max;
    q3Row.values[g.stationId] = g.q3;
    medRow.values[g.stationId] = g.median;
    q1Row.values[g.stationId] = g.q1;
    minRow.values[g.stationId] = g.min;
  }

  return {
    stations,
    rows: [maxRow, q3Row, medRow, q1Row, minRow],
  };
};

export interface StationQ3ComparisonData {
  stations: string[];
  q3Values: number[];
  details: Record<string, StationBoxGroup>;
}

/** 提取各机台的 Q3 序列用于机台对比折线图 */
export const getStationQ3ComparisonData = (
  groups: StationBoxGroup[],
): StationQ3ComparisonData => {
  const stations: string[] = [];
  const q3Values: number[] = [];
  const details: Record<string, StationBoxGroup> = {};

  for (const g of groups) {
    stations.push(g.stationId);
    q3Values.push(g.q3);
    details[g.stationId] = g;
  }

  return { stations, q3Values, details };
};

/** 自定义参考线/阈值线定义 */
export interface ComparisonReferenceLine {
  id: string;
  value: number;
  label: string;
  color?: string;
}
