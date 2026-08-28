// CPK 统计引擎：均值 / 标准差 / Cpu / Cpl / Cpk / 直方图分箱
// 公式与产线测试系统一致：Cpu=(USL-mean)/(3σ)  Cpl=(mean-LSL)/(3σ)  Cpk=min(Cpu,Cpl)

/** 单次遍历求极值：避免对大样本数组使用展开参数导致超出调用栈上限。 */
export function minMax(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** 由极值构造 stat 的 max/min 字段（空样本时为 0）。 */
function mmToStat(values: number[], n: number): { max: number; min: number } {
  if (n === 0) return { max: 0, min: 0 };
  const [lo, hi] = minMax(values);
  return { max: hi, min: lo };
}

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
  /** 数据范围 [lo, hi]（floor(min)-1 ~ ceil(max)+1，不含规格限并入；含手动 Range 覆盖） */
  dataDomain: [number, number];
  /** 规格限是否落在绘图域内（决定是否绘制红线） */
  hasLimits: boolean;
}

const NA_TOKENS = new Set(['', 'na', 'n/a', 'none', 'null']);

/** 是否为空白/NA（Empty）。 */
export function isEmptyValue(raw: string): boolean {
  const v = raw.trim();
  return v.length === 0 || NA_TOKENS.has(v.toLowerCase());
}

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

/**
 * 直方图分箱（对齐 OPP histogramBinsGenerateWithReturnSet: 反编译实现）：
 * - 默认域 = floor(dataMin)-1 ~ ceil(dataMax)+1；常量数据改为 max×1.1 / min×0.9 且整体偏移 1 bin；
 * - 手动 Range 覆盖；规格限仅在其显示开启时并入域（OPP 受 displayLimits 控制）；
 * - 越界样本丢弃（不入任何柱，OPP 分箱越界时同样丢弃）；
 * - percent 分母 = 计入柱的样本总数（OPP generateDataWithCounts 的累加总数）。
 */
export function computeBins(
  values: number[],
  upper: number | null,
  lower: number | null,
  binCount: number | null = 75,
  rangeLo: number | null = null,
  rangeHi: number | null = null,
  displayLimits: boolean = true,
): { bins: HistogramBin[]; domain: [number, number]; dataDomain: [number, number] } {
  const empty = (): { bins: HistogramBin[]; domain: [number, number]; dataDomain: [number, number] } => {
    // 无有效数值：仍生成一个 0 高度柱位，让 X 轴有柱、Y 高度为 0
    const x0 = -0.5;
    return {
      bins: [{ x0, x1: x0 + 1, count: 0, percent: 0 }],
      domain: [-0.5, 0.5],
      dataDomain: [-0.5, 0.5],
    };
  };
  if (values.length === 0) return empty();
  let [lo, hi] = minMax(values);
  // 对齐 OPP：binSize==0（常量数据）时 max×1.1、min×0.9，且所有分箱 idx 整体 +1
  let idxOffset = 0;
  if (lo === hi) {
    hi *= 1.1;
    lo *= 0.9;
    idxOffset = 1;
  } else {
    // 对齐 OPP（反编译实证）：X 轴基准 = floor(dataMin)-1 ~ ceil(dataMax)+1
    lo = Math.floor(lo) - 1;
    hi = Math.ceil(hi) + 1;
  }
  // 手动显示范围（Range）覆盖 X 轴范围（对齐 OPP 设置面板 Upper/Lower Range）
  if (rangeLo !== null) lo = rangeLo;
  if (rangeHi !== null) hi = rangeHi;
  if (!(hi > lo)) return empty();
  // 数据范围：floor/ceil±1 + 手动 Range（不含规格限并入）——供设置面板 Range 自动显示，改 Limit 不影响它
  const dataLo = lo;
  const dataHi = hi;
  const dataDomain: [number, number] = [dataLo, dataHi];
  // 超出显示范围的值被过滤，不进入柱子（NA 单独计数）
  const visible = values.filter((v) => v >= lo && v <= hi);
  if (visible.length === 0) return empty();
  // 规格限并入绘图域：仅在其显示开启时（OPP displayLimits 控制是否并入 histogramMin/Max）
  if (displayLimits) {
    if (upper !== null) hi = Math.max(hi, upper);
    if (lower !== null) lo = Math.min(lo, lower);
  }
  const span = hi - lo;

  // 对齐 OPP：bin 数 = histogramBinCount（可配置，默认 75）；binSize = span/binCount
  const safeCount = typeof binCount === 'number' && Number.isFinite(binCount) && binCount > 0 ? binCount : 75;
  const binWidth = span / safeCount;

  // 与 OPP 一致：bin 边 = histMin + i*binSize，bin 数严格 = histogramBinCount
  const x0 = lo;
  const binN = safeCount;
  const counts = new Array<number>(binN).fill(0);
  for (const v of visible) {
    // 对齐 OPP：无 clamp，越界样本丢弃（v == hi 时 idx == binN，同样丢弃）
    const idx = Math.floor((v - x0) / binWidth) + idxOffset;
    if (idx < 0 || idx >= binN) continue;
    counts[idx] += 1;
  }
  // 对齐 OPP：percent 分母 = 实际计入柱的样本总数
  let total = 0;
  for (const c of counts) total += c;
  const bins: HistogramBin[] = [];
  for (let i = 0; i < binN; i += 1) {
    bins.push({
      x0: x0 + i * binWidth,
      x1: x0 + (i + 1) * binWidth,
      count: counts[i],
      percent: total > 0 ? (counts[i] / total) * 100 : 0,
    });
  }
  return { bins, domain: [x0, x0 + binN * binWidth], dataDomain };
}

/**
 * 为 AB 对比计算共享 X 轴域与分箱，使得两图刻度完全一致、公用一套设置。
 * 域 = 合并样本的 floor(min)-1~ceil(max)+1 ∪ 手动 Range ∪ 合并规格限；
 * 分箱数与 bin 宽在共享 span 上统一，保证柱位一一对齐。
 */
export function analyzeColumnPair(
  columnA: TestColumn,
  rawA: string[],
  columnB: TestColumn,
  rawB: string[],
  binCount: number | null = 75,
  rangeLo: number | null = null,
  rangeHi: number | null = null,
  displayLimits: boolean = true,
): { a: ColumnAnalysis; b: ColumnAnalysis } {
  const effUpper = (() => {
    const ua = columnA.upper, ub = columnB.upper;
    if (ua !== null && ub !== null) return Math.max(ua, ub);
    return ua ?? ub;
  })();
  const effLower = (() => {
    const la = columnA.lower, lb = columnB.lower;
    if (la !== null && lb !== null) return Math.min(la, lb);
    return la ?? lb;
  })();

  const parseOne = (rawValues: string[]) => {
    const values: number[] = [];
    let naCount = 0;
    let valueCount = 0;
    for (const raw of rawValues) {
      if (isEmptyValue(raw)) { naCount += 1; continue; }
      valueCount += 1;
      const v = parseCell(raw);
      if (v !== null) values.push(v);
    }
    const binValues = values.length > 0 ? values : valueCount > 0 ? new Array<number>(valueCount).fill(0) : values;
    return { values, binValues, naCount, valueCount };
  };

  const pA = parseOne(rawA);
  const pB = parseOne(rawB);

  // 按 computeBins 的 floor/ceil 逻辑计算合并数据域
  const combinedBinValues = [...pA.binValues, ...pB.binValues];
  let sharedDataDomain: [number, number];
  let sharedDomain: [number, number];
  // 对齐 OPP：常量数据 max×1.1 / min×0.9，分箱 idx 整体 +1
  let idxOffset = 0;
  if (combinedBinValues.length === 0) {
    sharedDataDomain = [-0.5, 0.5];
    sharedDomain = [-0.5, 0.5];
  } else {
    let [lo, hi] = minMax(combinedBinValues);
    if (lo === hi) { hi *= 1.1; lo *= 0.9; idxOffset = 1; } else {
      lo = Math.floor(lo) - 1;
      hi = Math.ceil(hi) + 1;
    }
    if (rangeLo !== null) lo = rangeLo;
    if (rangeHi !== null) hi = rangeHi;
    if (!(hi > lo)) {
      sharedDataDomain = [-0.5, 0.5];
      sharedDomain = [-0.5, 0.5];
    } else {
      sharedDataDomain = [lo, hi];
      let dlo = lo, dhi = hi;
      // 对齐 OPP：规格限仅在其显示开启时并入共享绘图域
      if (displayLimits) {
        if (effUpper !== null) dhi = Math.max(dhi, effUpper);
        if (effLower !== null) dlo = Math.min(dlo, effLower);
      }
      sharedDomain = [dlo, dhi];
    }
  }

  const buildOne = (
    column: TestColumn,
    parsed: { values: number[]; binValues: number[]; naCount: number; valueCount: number },
  ): ColumnAnalysis => {
    const { values, binValues, naCount, valueCount } = parsed;
    // 统计量仍按各自样本计算
    const m = mean(values);
    const s = stdDev(values, m);
    const n = valueCount;
    const vN = values.length;

    // 在共享域上做分箱（复用与 computeBins 相同的计数逻辑）
    let bins: HistogramBin[];
    const [dlo, dhi] = sharedDomain;
    if (!(dhi > dlo) || binValues.length === 0) {
      bins = [{ x0: -0.5, x1: 0.5, count: 0, percent: 0 }];
    } else {
      const span = dhi - dlo;
      const safeCount = typeof binCount === 'number' && Number.isFinite(binCount) && binCount > 0 ? binCount : 75;
      const binWidth = span / safeCount;
      const visible = binValues.filter((v) => v >= dlo && v <= dhi);
      const counts = new Array<number>(safeCount).fill(0);
      for (const v of visible) {
        // 对齐 OPP：无 clamp，越界样本丢弃；常量数据整体 +1 bin
        const idx = Math.floor((v - dlo) / binWidth) + idxOffset;
        if (idx < 0 || idx >= safeCount) continue;
        counts[idx] += 1;
      }
      let total = 0;
      for (const c of counts) total += c;
      bins = [];
      for (let i = 0; i < safeCount; i += 1) {
        bins.push({
          x0: dlo + i * binWidth,
          x1: dlo + (i + 1) * binWidth,
          count: counts[i],
          percent: total > 0 ? (counts[i] / total) * 100 : 0,
        });
      }
    }

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
      ...mmToStat(values, vN),
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
      domain: sharedDomain,
      dataDomain: sharedDataDomain,
      hasLimits: column.upper !== null || column.lower !== null,
    };
  };

  const a = buildOne(columnA, pA);
  const b = buildOne(columnB, pB);
  // hasLimits 取并集，保证红线在两侧一致可见
  const sharedHasLimits = a.hasLimits || b.hasLimits;
  a.hasLimits = sharedHasLimits;
  b.hasLimits = sharedHasLimits;
  return { a, b };
}

/** 单测试项全量分析。 */
export function analyzeColumn(
  column: TestColumn,
  rawValues: string[],
  binCount: number | null = 75,
  rangeLo: number | null = null,
  rangeHi: number | null = null,
  displayLimits: boolean = true,
): ColumnAnalysis {
  const values: number[] = [];
  let naCount = 0; // 空白 / Empty 行数
  let valueCount = 0; // 有内容（非空）的行数 —— Data Count 依据
  for (const raw of rawValues) {
    if (isEmptyValue(raw)) {
      naCount += 1;
      continue;
    }
    valueCount += 1;
    const v = parseCell(raw);
    if (v !== null) values.push(v);
  }

  const n = valueCount; // Data Count：有值行数（SerialNumber 等文本列也正常计数）
  const vN = values.length;
  const m = mean(values);
  const s = stdDev(values, m);
  // 有内容但无有效数值的列（如 SerialNumber 文本列）：按单 bin 于 x=0 显示满柱（Y 轴反映 Data Count）
  const binValues = values.length > 0 ? values : valueCount > 0 ? new Array<number>(valueCount).fill(0) : values;
  const { bins, domain, dataDomain } = computeBins(binValues, column.upper, column.lower, binCount, rangeLo, rangeHi, displayLimits);

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
    ...mmToStat(values, vN),
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
    dataDomain,
    hasLimits: column.upper !== null || column.lower !== null,
  };
}

/**
 * 测量值格式化 — 对齐 OPP 直方图：Max/Min/Mean/Std.Dev 固定 4 位小数（%.4f）。
 * X 轴刻度用 formatTick（整数时省略小数点）。
 */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return 'N/A';
  return v.toFixed(4);
}

/**
 * 指数（Cpu/Cpl/Cpk）格式化，对齐 OPP：4 位小数（%.4f），
 * 无规格限或 σ=0 无法计算时显示 N/A。
 */
export function formatIndex(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'N/A';
  return v.toFixed(4);
}

/** X 轴刻度：整数显示不补小数位，其余按量级取 2~4 位。 */
export function formatTick(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (Number.isInteger(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

/**
 * 累积分布函数（CDF）数据：样本升序排序，每点累积占比（0~100%）。
 * 对齐 OPP generateCDFVectorWithCDF:AndXValues:（排序 + 累积计数）。
 */
export function computeCdf(values: number[]): Array<{ x: number; y: number }> {
  if (values.length === 0) return [];
  const sorted = values.toSorted((a, b) => a - b);
  const n = sorted.length;
  return sorted.map((v, i) => ({ x: v, y: ((i + 1) / n) * 100 }));
}

/** 人类可读的测试项简称（去除冗余前缀，用于列表展示）。 */
export function shortName(name: string): string {
  return name.replace(/^Power /, '').replace(/^DUTInfo /, '').replace(/^Process /, '');
}

/**
 * Pearson 相关系数 + 线性回归（对齐 OPP generatePearsonCorrelationCoefficient）：
 * X/Y 逐行配对，跳过任一侧 NA；返回 r（相关系数）、slope（斜率）、intercept（截距）与配对 n。
 */
export function pearsonCorrelation(
  xs: number[],
  ys: number[],
): { r: number | null; slope: number; intercept: number; n: number } {
  const pairs: Array<[number, number]> = [];
  const n0 = Math.min(xs.length, ys.length);
  for (let i = 0; i < n0; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  const n = pairs.length;
  if (n < 2) return { r: null, slope: 0, intercept: 0, n };
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pairs) {
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const meanX = sx / n;
  const meanY = sy / n;
  const ssxx = sxx - (sx * sx) / n;
  const ssyy = syy - (sy * sy) / n;
  const ssxy = sxy - (sx * sy) / n;
  let slope = 0;
  if (ssxx !== 0) slope = ssxy / ssxx;
  const intercept = meanY - slope * meanX;
  let r: number | null = null;
  if (ssxx !== 0 && ssyy !== 0) {
    const val = ssxy / Math.sqrt(ssxx * ssyy);
    r = Number.isFinite(val) ? val : null;
  }
  return { r, slope, intercept, n };
}

/** 图表显示设置（对齐 OPP 直方图设置面板）。 */
export interface ChartSettings {
  /** 显示标题 */
  showTitle: boolean;
  /** 显示统计块 */
  showStats: boolean;
  /** 显示规格限红线 */
  showLimits: boolean;
  /** 柱顶显示数量 */
  showCounts: boolean;
  /** Y 轴用百分比（true）而非数量（false） */
  showPercentage: boolean;
  /** 柱子描边（outline） */
  showOutlines: boolean;
  /** bin 数量（null=默认 75） */
  binCount: number | null;
  /** Y 轴上限（null=自动） */
  yUpper: number | null;
  /** 手动上规格限（null=沿用 CSV / 不设置） */
  upperLimit: number | null;
  /** 手动下规格限（null=沿用 CSV / 不设置） */
  lowerLimit: number | null;
  /** 手动显示范围上限（X 轴，null=自动） */
  upperRange: number | null;
  /** 手动显示范围下限（X 轴，null=自动） */
  lowerRange: number | null;
  /** CDF：X 轴用对数刻度 */
  cdfLog: boolean;
  /** CDF：曲线下方填充 */
  cdfFill: boolean;
  /** Time Series：显示均值虚线 */
  tsMean: boolean;
  /** Time Series：折线下方区域填充（Show Fill 复选框，对齐 OPP displayFill） */
  tsFill: boolean;
  /** Time Series：显示数据点（旧布尔，已由 dataSymbol 取代，保留兼容） */
  tsPoints: boolean;
  /** Time Series：显示折线（Show Lines 复选框，对齐 OPP displayLines） */
  tsLines: boolean;
  /** 图例是否显示 */
  legendEnabled: boolean;
  /** 图例位置（OPP：None/TopRight/BottomRight/TopLeft/BottomLeft） */
  legendPosition: 'none' | 'topright' | 'bottomright' | 'topleft' | 'bottomleft';
  /** 图例中显示计数 */
  legendCounts: boolean;
  /** CDF：概率显示百分位（Show Hundredths） */
  cdfShowHundredths: boolean;
  /** CDF：类型（CDF/CCDF/Folded） */
  cdfType: 'cdf' | 'ccdf' | 'folded';
  /** TimeSeries / Data：线宽（None/Thin/Med/Thick） */
  lineWidth: 'none' | 'thin' | 'med' | 'thick';
  /** TimeSeries / Data：数据点符号（None/O/+/x） */
  dataSymbol: 'none' | 'circle' | 'plus' | 'cross';
  /** Correlation：显示正方形（等距 X/Y） */
  corrSquare: boolean;
  /** Correlation：显示回归线 */
  corrRegression: boolean;
  /** Correlation：高亮离群点 */
  corrHighlightOutliers: boolean;
  /** Correlation：离群点 σ 阈值 */
  corrOutlierSigma: number | null;
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  showTitle: true,
  showStats: true,
  showLimits: true,
  showCounts: true,
  showPercentage: false,
  showOutlines: false,
  binCount: 75,
  yUpper: null,
  upperLimit: null,
  lowerLimit: null,
  upperRange: null,
  lowerRange: null,
  cdfLog: false,
  cdfFill: false,
  tsMean: true,
  tsFill: false,
  tsPoints: true,
  tsLines: true,
  legendEnabled: false,
  legendPosition: 'bottomright',
  legendCounts: false,
  cdfShowHundredths: false,
  cdfType: 'cdf',
  lineWidth: 'med',
  dataSymbol: 'none',
  corrSquare: false,
  corrRegression: true,
  corrHighlightOutliers: false,
  corrOutlierSigma: 3,
};