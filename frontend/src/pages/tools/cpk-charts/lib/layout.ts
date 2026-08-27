// 直方图布局常量与坐标映射（组件与导出模块共用，保持单一来源）

export const W = 1000;
export const H = 300;
export const PLOT_LEFT = 208;
export const PLOT_RIGHT = 988;
export const PLOT_TOP = 40;
export const PLOT_BOTTOM = 240;
export const PLOT_W = PLOT_RIGHT - PLOT_LEFT;
export const PLOT_H = PLOT_BOTTOM - PLOT_TOP;
export const SPEC_COLOR = '#ef4444';

/** X 轴像素映射（绘图域 [lo, hi] → [PLOT_LEFT, PLOT_RIGHT]）。 */
export const mapX = (lo: number, hi: number, v: number): number =>
  PLOT_LEFT + ((v - lo) / (hi - lo)) * PLOT_W;

/**
 * Heckbert nice number — 对齐 CorePlot 的 CPTNiceNum（反编译实证）：
 * exp = floor(log10(|x|))；f = |x| / 10^exp；nf = f<1.5 ? 1 : f<3 ? 2 : f<7 ? 5 : 10；
 * 结果 = sign * nf * 10^exp（阈值 1.5 / 3 / 7，而非 1 / 2 / 5）。
 */
export function cptNiceNum(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const exp = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, exp);
  const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

/** OPP Automatic labeling（preferredNumberOfMajorTicks 默认 5）的主刻度与步长。 */
function autoTicks(lo: number, hi: number, preferred: number): { ticks: number[]; interval: number } {
  const span = hi - lo;
  if (!(span > 0)) return { ticks: [], interval: 1 };
  const effective = preferred === 0 ? 5 : preferred === 1 ? 2 : preferred;
  let interval: number;
  if (effective === 2) {
    // CorePlot：preferred==2 时 interval = CPTNiceLength(length)（与 nice 逻辑等价）
    interval = cptNiceNum(span / 2);
  } else {
    interval = cptNiceNum(span / Math.max(1, effective - 1));
  }
  if (!(interval > 0) || !Number.isFinite(interval)) interval = 1;
  const start = Math.round(lo / interval) * interval;
  const ticks: number[] = [];
  for (let v = start; v <= hi + interval / 2; v += interval) {
    if (v >= lo - interval / 2) ticks.push(v);
  }
  return { ticks, interval };
}

/** 生成与 OPP 直方图一致的 X 轴主刻度（Automatic，preferred=5）。 */
export function ticksFor(lo: number, hi: number): number[] {
  return autoTicks(lo, hi, 5).ticks;
}

/** 主刻度间隔（供次刻度生成复用）。 */
export function oppInterval(lo: number, hi: number, preferred = 5): number {
  return autoTicks(lo, hi, preferred).interval;
}

/** 每主刻度间插入 perInterval 条次刻度的位置（对齐 CorePlot minor ticks）。 */
export function minorTicks(lo: number, hi: number, interval: number, perInterval: number): number[] {
  if (!(perInterval > 0) || !(interval > 0)) return [];
  const start = Math.round(lo / interval) * interval;
  const out: number[] = [];
  for (let v = start; v <= hi; v += interval) {
    for (let k = 1; k <= perInterval; k += 1) {
      const m = v + (k * interval) / (perInterval + 1);
      if (m > lo && m < hi) out.push(m);
    }
  }
  return out;
}

/** Y 轴主刻度（对齐 OPP）：从 0 起，以给定 interval 步进覆盖 yMax。 */
export function yTicksFor(yMax: number, interval: number): number[] {
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + interval / 2; v += interval) ticks.push(v);
  return ticks;
}

/**
 * 10 的幂步长 — 对齐 OPP calculateAxisLimits：majorInterval = 10^ceil(log10(span/divisor))。
 * CDF / TimeSeries 的 Y 轴用此间隔。
 */
export function pow10Interval(span: number, divisor = 10): number {
  if (!(span > 0)) return 1;
  return Math.pow(10, Math.ceil(Math.log10(span / divisor)));
}
