// CPK 统计引擎：均值 / 标准差 / Cpu / Cpl / Cpk / 直方图分箱
// 公式与产线测试系统一致：Cpu=(USL-mean)/(3σ)  Cpl=(mean-LSL)/(3σ)  Cpk=min(Cpu,Cpl)

export interface TestColumn {
  /** 测试项完整名称（CSV 列名） */
  name: string;
  /** 测量单位（KHz / dBm / % / mV / mA ...），NA 表示无单位 */
  unit: string;
  /** 上规格限，null 表示未定义 */
  upper: number | null;
  /** 下规格限，null 表示未定义 */
  lower: number | null;
}

export interface ColumnStat {
  /** 有效数值样本数 */
  count: number;
  /** NA / 非数值个数 */
  naCount: number;
  /** 超出规格限的样本数 */
  failureCount: number;
  /** 失败率 % */
  failureRate: number;
  max: number;
  min: number;
  mean: number;
  /** 样本标准差（ddof=1） */
  stdDev: number;
  cpu: number | null;
  cpl: number | null;
  cpk: number | null;
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
  /** 相对频率 % */
  percent: number;
}

export interface ColumnAnalysis {
  column: TestColumn;
  values: number[];
  stat: ColumnStat;
  bins: HistogramBin[];
  /** 绘图域 [lo, hi]，已包含规格限并向外留白 */
  domain: [number, number];
  /** 规格限是否落在绘图域内（决定是否绘制红线） */
  hasLimits: boolean;
}

const NA_TOKENS = new Set(['', 'na', 'n/a', 'none', 'null']);

/** 解析单元格：非数值返回 null。 */
export function parseCell(raw: string): number | null {
  const v = raw.trim();
  if (v.length === 0) return null;
  if (NA_TOKENS.has(v.toLowerCase())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 测试项列定义（字符串规格限 → 数值）。 */
export function makeColumn(name: string, unit: string, upper: string, lower: string): TestColumn {
  return {
    name,
    unit: unit && !NA_TOKENS.has(unit.toLowerCase()) ? unit : '',
    upper: parseCell(upper),
    lower: parseCell(lower),
  };
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function stdDev(values: number[], m: number): number {
  if (values.length < 2) return 0;
  let acc = 0;
  for (const v of values) {
    const d = v - m;
    acc += d * d;
  }
  return Math.sqrt(acc / (values.length - 1));
}

/** nice 步长：1/2/5 × 10^k，向 target 取整。 */
export function niceStep(target: number): number {
  if (!(target > 0) || !Number.isFinite(target)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const norm = target / pow;
  let step: number;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 5) step = 5;
  else step = 10;
  return step * pow;
}

/**
 * 直方图分箱。
 * 绘图域 = 数据范围 ∪ 规格限范围，再向外各扩展 5%（两侧）；
 * bin 宽取 nice 步长，目标 bin 数约 max(16, sqrt(n) * 2)，上限 90。
 */
export function computeBins(
  values: number[],
  upper: number | null,
  lower: number | null,
): { bins: HistogramBin[]; domain: [number, number] } {
  if (values.length === 0) {
    return { bins: [], domain: [0, 1] };
  }
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (upper !== null) hi = Math.max(hi, upper);
  if (lower !== null) lo = Math.min(lo, lower);
  if (lo === hi) {
    // 常量列：向两侧各扩展 1 个单位（或相对量）
    const pad = Math.max(Math.abs(lo) * 0.01, 0.5);
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo;
  const pad = span * 0.05;
  lo -= pad;
  hi += pad;

  const n = values.length;
  const targetBins = Math.min(90, Math.max(16, Math.ceil(Math.sqrt(n) * 2)));
  let binWidth = niceStep(span / targetBins);
  if (binWidth <= 0) binWidth = 1;

  const x0 = Math.floor(lo / binWidth) * binWidth;
  const binCount = Math.max(1, Math.ceil((hi - x0) / binWidth));
  const counts = new Array<number>(binCount).fill(0);
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((v - x0) / binWidth)));
    counts[idx] += 1;
  }
  const bins: HistogramBin[] = [];
  for (let i = 0; i < binCount; i += 1) {
    bins.push({
      x0: x0 + i * binWidth,
      x1: x0 + (i + 1) * binWidth,
      count: counts[i],
      percent: (counts[i] / n) * 100,
    });
  }
  return { bins, domain: [x0, x0 + binCount * binWidth] };
}

/** 单测试项全量分析。 */
export function analyzeColumn(column: TestColumn, rawValues: string[]): ColumnAnalysis {
  const values: number[] = [];
  let naCount = 0;
  for (const raw of rawValues) {
    const v = parseCell(raw);
    if (v === null) naCount += 1;
    else values.push(v);
  }

  const n = values.length;
  const m = mean(values);
  const s = stdDev(values, m);
  const { bins, domain } = computeBins(values, column.upper, column.lower);

  let failureCount = 0;
  for (const v of values) {
    if (column.upper !== null && v > column.upper) failureCount += 1;
    else if (column.lower !== null && v < column.lower) failureCount += 1;
  }

  const safe = (fn: (d: number) => number): number | null => {
    if (s <= 0) return null;
    const v = fn(s);
    return Number.isFinite(v) ? v : null;
  };
  const cpu = column.upper !== null ? safe((d) => (column.upper! - m) / (3 * d)) : null;
  const cpl = column.lower !== null ? safe((d) => (m - column.lower!) / (3 * d)) : null;
  let cpk: number | null = null;
  if (cpu !== null && cpl !== null) cpk = Math.min(cpu, cpl);
  else if (cpu !== null) cpk = cpu;
  else if (cpl !== null) cpk = cpl;
  if (cpk !== null && cpk < 0) cpk = 0;

  const stat: ColumnStat = {
    count: n,
    naCount,
    failureCount,
    failureRate: n === 0 ? 0 : (failureCount / n) * 100,
    max: n === 0 ? 0 : Math.max(...values),
    min: n === 0 ? 0 : Math.min(...values),
    mean: m,
    stdDev: s,
    cpu,
    cpl,
    cpk,
  };

  return {
    column,
    values,
    stat,
    bins,
    domain,
    hasLimits: column.upper !== null || column.lower !== null,
  };
}

/** 按数值量级格式化测量值。 */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 10000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

/** Cpk 类指数格式化。 */
export function formatIndex(v: number | null): string {
  if (v === null) return '—';
  if (!Number.isFinite(v)) return '∞';
  return v.toFixed(4);
}

/** 人类可读的测试项简称（去除冗余前缀，用于列表展示）。 */
export function shortName(name: string): string {
  return name.replace(/^Power /, '').replace(/^DUTInfo /, '').replace(/^Process /, '');
}

