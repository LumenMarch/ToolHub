import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedDataset } from '../lib/csv';
import { parseTestCsv } from '../lib/csv';
import { analyzeColumn, analyzeColumnPair, DEFAULT_CHART_SETTINGS, type ChartSettings, type ColumnAnalysis } from '../lib/stats';
import type { CorrelationPair } from '../components/CorrelationChart';
import { shortName } from '../lib/stats';

/** 并集项：对齐 index.tsx 的 MergeItem */
export interface MergeItem {
  name: string;
  unit: string;
  hasA: boolean;
  hasB: boolean;
  /** 至少一份数据中该列有可解析数值（false = 纯文本/无数值列也展示） */
  hasData: boolean;
}

type ChartType = 'histogram' | 'cdf' | 'timeseries' | 'correlation';

interface OppState {
  fileA: File | null;
  fileB: File | null;
  fileNameA: string;
  fileNameB: string;
  datasetA: ParsedDataset | null;
  datasetB: ParsedDataset | null;
  compareMode: boolean;
  loading: boolean;
  progress: number;
  error: string;
  selectedName: string;
  query: string;
  corrYName: string;
  chartType: ChartType;
  settings: ChartSettings;
}

interface OppActions {
  setFileA: (f: File | null) => void;
  setFileB: (f: File | null) => void;
  setFileNameA: (v: string) => void;
  setFileNameB: (v: string) => void;
  setDatasetA: (ds: ParsedDataset | null) => void;
  setDatasetB: (ds: ParsedDataset | null) => void;
  setCompareMode: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  setProgress: (v: number) => void;
  setError: (v: string) => void;
  setSelectedName: (v: string) => void;
  setQuery: (v: string) => void;
  setCorrYName: (v: string) => void;
  setChartType: (v: ChartType) => void;
  updateSetting: <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => void;
  setSettings: (s: ChartSettings) => void;
  /** 迁移自 index.tsx 的 handleFileA/B */
  loadFileA: (file: File) => Promise<void>;
  loadFileB: (file: File) => Promise<void>;
  clearFileA: () => void;
  clearFileB: () => void;
  reset: () => void;
}

export type OppStore = OppState & OppActions;

async function parseFileViaWorker(file: File, onProgress?: (p: number) => void): Promise<ParsedDataset> {
  // 大文件走 Worker，小文件直接解析，避免 Worker 开销
  const THRESHOLD = 5 * 1024 * 1024; // 5MB
  if (file.size > THRESHOLD && typeof Worker !== 'undefined') {
    try {
      const buf = await file.arrayBuffer();
      return await new Promise<ParsedDataset>((resolve, reject) => {
        const worker = new Worker(new URL('../workers/csv.worker.ts', import.meta.url), { type: 'module' });
        const id = String(Date.now()) + Math.random().toString(16).slice(2);
        // 无进度心跳超时：每条 progress 重置计时器，避免大文件解析总时长超 30s 被误杀
        let timeout: ReturnType<typeof setTimeout>;
        const arm = (): void => {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker 解析超时'));
          }, 30000);
        };
        arm();
        worker.onmessage = (e: MessageEvent) => {
          const data = e.data as { id: string; type: string; progress?: number; dataset?: ParsedDataset; error?: string };
          if (data.id !== id) return;
          if (data.type === 'progress' && typeof data.progress === 'number') {
            arm();
            onProgress?.(data.progress);
          } else if (data.type === 'done' && data.dataset) {
            clearTimeout(timeout);
            worker.terminate();
            // 与主线程路径一致：无有效数值列时报错而非静默成功
            if (data.dataset.columns.length === 0) {
              reject(new Error('未找到含数值的测试项列'));
              return;
            }
            resolve(data.dataset);
          } else if (data.type === 'error') {
            clearTimeout(timeout);
            worker.terminate();
            reject(new Error(data.error || 'Worker 解析失败'));
          }
        };
        worker.onerror = (ev) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(ev.message || 'Worker 异常'));
        };
        // 传递 ArrayBuffer（可转移）
        worker.postMessage({ id, buffer: buf, fileName: file.name }, [buf]);
      });
    } catch {
      // 回落到主线程解析
    }
  }
  const text = await file.text();
  const ds = parseTestCsv(text);
  if (ds.columns.length === 0) throw new Error('未找到含数值的测试项列');
  return ds;
}

// WeakMap 键占位（无数据集时的稳定引用）
const EMPTY_DATASET: ParsedDataset = { title: '', records: 0, columns: [], rows: [], skippedColumns: [], allColumns: [] };

const initialState: OppState = {
  fileA: null,
  fileB: null,
  fileNameA: '',
  fileNameB: '',
  datasetA: null,
  datasetB: null,
  compareMode: false,
  loading: false,
  progress: 0,
  error: '',
  selectedName: '',
  query: '',
  corrYName: '',
  chartType: 'histogram',
  settings: { ...DEFAULT_CHART_SETTINGS },
};

export const useOppStore = create<OppStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setFileA: (f) => set({ fileA: f }),
      setFileB: (f) => set({ fileB: f }),
      setFileNameA: (v) => set({ fileNameA: v }),
      setFileNameB: (v) => set({ fileNameB: v }),
      setDatasetA: (ds) => {
        set({ datasetA: ds });
        const { selectedName } = get();
        if (ds && ds.columns.length > 0) {
          const exists = ds.columns.some((c) => c.name === selectedName);
          if (!selectedName || !exists) {
            // 若 B 也存在则以并集首项为准，单纯 A 则取 A 首项
            const first = ds.columns[0].name;
            set({ selectedName: first });
          }
        }
      },
      setDatasetB: (ds) => set({ datasetB: ds }),
      setCompareMode: (v) => set({ compareMode: v }),
      setLoading: (v) => set({ loading: v }),
      setProgress: (v) => set({ progress: v }),
      setError: (v) => set({ error: v }),
      setSelectedName: (v) => set((s) => ({
        selectedName: v,
        // 切换测试项时清除手动 Upper/Lower Range，回落到该测试项的自动计算值
        ...(v !== s.selectedName ? { settings: { ...s.settings, upperRange: null, lowerRange: null } } : {}),
      })),
      setQuery: (v) => set({ query: v }),
      setCorrYName: (v) => set({ corrYName: v }),
      setChartType: (v) => set({ chartType: v }),
      updateSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setSettings: (s) => set({ settings: s }),
      loadFileA: async (file: File) => {
        set({ error: '', fileA: file, loading: true, progress: 0, fileNameA: file.name });
        try {
          const ds = await parseFileViaWorker(file, (p) => set({ progress: p }));
          set({ datasetA: ds, progress: 1 });
          // 自动选中首项（若当前未选中或不存在）
          const { selectedName } = get();
          const exists = ds.columns.some((c) => c.name === selectedName);
          if (!selectedName || !exists) set({ selectedName: ds.columns[0]?.name ?? '' });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'CSV 解析失败' });
        } finally {
          set({ loading: false });
        }
      },
      loadFileB: async (file: File) => {
        set({ error: '', fileB: file, loading: true, progress: 0, fileNameB: file.name });
        try {
          const ds = await parseFileViaWorker(file, (p) => set({ progress: p }));
          set({ datasetB: ds, progress: 1 });
          // 与 loadFileA 相同的兜底选择：仅加载 B（或 A 已清空）时自动选中首项
          const { selectedName } = get();
          const exists = ds.columns.some((c) => c.name === selectedName);
          if (!selectedName || !exists) set({ selectedName: ds.columns[0]?.name ?? '' });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'CSV 解析失败' });
        } finally {
          set({ loading: false });
        }
      },
      clearFileA: () => set({ fileA: null, datasetA: null, fileNameA: '' }),
      clearFileB: () => set({ fileB: null, datasetB: null, fileNameB: '' }),
      reset: () => set({ ...initialState, settings: { ...DEFAULT_CHART_SETTINGS } }),
    }),
    {
      name: 'opp:store',
      partialize: (state) => ({
        settings: state.settings,
        chartType: state.chartType,
        query: state.query,
        selectedName: state.selectedName,
        corrYName: state.corrYName,
        compareMode: state.compareMode,
      }),
    },
  ),
);

// ---------- Derived selectors (pure functions) ----------
// 记忆化缓存：zustand v5 的 selector 传入 useSyncExternalStore，返回值必须引用稳定，
// 否则 (s) => getMerged(s) 每次构建新数组会触发无限重渲染。
// 键 = (datasetA, datasetB, query)，值复用直到输入引用/查询变化。
const mergedCache = new WeakMap<ParsedDataset, MergeItem[]>();
const mergedCacheSub = new WeakMap<ParsedDataset, WeakMap<ParsedDataset, MergeItem[]>>();
const filteredCacheSub = new WeakMap<ParsedDataset, WeakMap<ParsedDataset, Map<string, MergeItem[]>>>();

export function getMerged(state: OppState): MergeItem[] {
  // 双数据集都要参与键；无数据集时用 placeholder 保证 WeakMap 键存在
  const keyA = state.datasetA ?? (EMPTY_DATASET as ParsedDataset);
  const keyB = state.datasetB ?? (EMPTY_DATASET as ParsedDataset);
  // 两数据集组合 → 用 A 的缓存再细分 B（简化：仅当 datasetB 存在时按 A+B 组合缓存）
  if (!state.datasetB) {
    const hit = mergedCache.get(keyA);
    if (hit) return hit;
    const out = buildMerged(state);
    mergedCache.set(keyA, out);
    return out;
  }
  // B 也存在：以 (A,B) 为组合键暂存于 A 的 WeakMap 中
  let sub = mergedCacheSub.get(keyA);
  if (!sub) {
    sub = new WeakMap<ParsedDataset, MergeItem[]>();
    mergedCacheSub.set(keyA, sub);
  }
  const hit = sub.get(keyB);
  if (hit) return hit;
  const out = buildMerged(state);
  sub.set(keyB, out);
  return out;
}

function buildMerged(state: OppState): MergeItem[] {
  const map = new Map<string, MergeItem>();
  const unitOf = new Map<string, string>();
  // 先建立 列名 → unit 与 hasData 的索引
  state.datasetA?.columns.forEach((c) => { unitOf.set(c.name, c.unit); });
  state.datasetB?.columns.forEach((c) => { if (!unitOf.has(c.name)) unitOf.set(c.name, c.unit); });
  const ensure = (n: string) => {
    let e = map.get(n);
    if (!e) e = { name: n, unit: unitOf.get(n) || '', hasA: false, hasB: false, hasData: false };
    return e;
  };
  // A 的完整表头顺序
  const aAll = state.datasetA?.allColumns ?? [];
  const aCols = new Set(state.datasetA?.columns.map((c) => c.name) ?? []);
  const bCols = new Set(state.datasetB?.columns.map((c) => c.name) ?? []);
  for (const n of aAll) {
    const e = ensure(n);
    e.hasA = true;
    e.hasData = aCols.has(n);
    map.set(n, e);
  }
  // B 的列（含 B 独有的新列）依 B 表头顺序追加
  const bAll = state.datasetB?.allColumns ?? [];
  for (const n of bAll) {
    const e = ensure(n);
    e.hasB = true;
    e.hasData = e.hasData || bCols.has(n);
    if (!aAll.includes(n)) map.set(n, e);
    else {
      // A 中已有（含文本列）：仅补 hasB，但需保持 A 顺序中的位置
      map.set(n, e);
    }
  }
  return Array.from(map.values());
}

export function getFiltered(state: OppState): MergeItem[] {
  const merged = getMerged(state);
  const q = state.query.trim();
  const keyA = state.datasetA ?? (EMPTY_DATASET as ParsedDataset);
  const keyB = state.datasetB ?? (EMPTY_DATASET as ParsedDataset);
  let sub = filteredCacheSub.get(keyA);
  if (!sub) {
    sub = new WeakMap<ParsedDataset, Map<string, MergeItem[]>>();
    filteredCacheSub.set(keyA, sub);
  }
  let byQ = sub.get(keyB);
  if (!byQ) {
    byQ = new Map<string, MergeItem[]>();
    sub.set(keyB, byQ);
  }
  const hit = byQ.get(q);
  if (hit) return hit;
  let out: MergeItem[];
  if (!q) {
    out = merged;
  } else {
    // 使用 grep 兼容层：非法正则回落为 includes
    try {
      const sanitized = q.replace(/^\s*\(\?i\)\s*/, '');
      const re = new RegExp(sanitized, 'i');
      out = merged.filter((m) => re.test(m.name));
    } catch {
      const low = q.toLowerCase();
      out = merged.filter((m) => m.name.toLowerCase().includes(low));
    }
  }
  // 只保留最近一次查询结果：逐字输入时避免缓存随中间状态无限增长
  if (byQ.size > 0 && !byQ.has(q)) byQ.clear();
  byQ.set(q, out);
  return out;
}

export function getActive(
  dataset: ParsedDataset | null,
  selectedName: string,
  settings: ChartSettings,
): { index: number; analysis: ColumnAnalysis } | null {
  if (!dataset || !selectedName) return null;
  const idx = dataset.columns.findIndex((c) => c.name === selectedName);
  if (idx < 0) return null;
  const column = dataset.columns[idx];
  const eff = {
    ...column,
    upper: settings.upperLimit !== null ? settings.upperLimit : column.upper,
    lower: settings.lowerLimit !== null ? settings.lowerLimit : column.lower,
  };
  const raw = dataset.rows.map((r) => r[idx] ?? 'NA');
  return { index: idx, analysis: analyzeColumn(eff, raw, settings.binCount, settings.lowerRange, settings.upperRange, settings.showLimits) };
}

export function getCorrPair(
  dataset: ParsedDataset | null,
  selectedName: string,
  corrYName: string,
  settings: ChartSettings,
): CorrelationPair | null {
  if (!dataset || !selectedName || !corrYName || corrYName === selectedName) return null;
  const ix = dataset.columns.findIndex((c) => c.name === selectedName);
  const iy = dataset.columns.findIndex((c) => c.name === corrYName);
  if (ix < 0 || iy < 0) return null;
  return {
    xName: shortName(selectedName),
    yName: shortName(corrYName),
    rawX: dataset.rows.map((row) => row[ix] ?? 'NA'),
    rawY: dataset.rows.map((row) => row[iy] ?? 'NA'),
    xUpper: settings.upperLimit !== null ? settings.upperLimit : dataset.columns[ix].upper,
    xLower: settings.lowerLimit !== null ? settings.lowerLimit : dataset.columns[ix].lower,
    yUpper: dataset.columns[iy].upper,
    yLower: dataset.columns[iy].lower,
  };
}

export function getSharedPair(state: OppState): { idxA: number; idxB: number; pair: { a: ColumnAnalysis; b: ColumnAnalysis } } | null {
  if (!state.compareMode || !state.selectedName || !state.datasetA || !state.datasetB) return null;
  const idxA = state.datasetA.columns.findIndex((c) => c.name === state.selectedName);
  const idxB = state.datasetB.columns.findIndex((c) => c.name === state.selectedName);
  if (idxA < 0 || idxB < 0) return null;
  const colA = state.datasetA.columns[idxA];
  const colB = state.datasetB.columns[idxB];
  const effA = { ...colA, upper: state.settings.upperLimit !== null ? state.settings.upperLimit : colA.upper, lower: state.settings.lowerLimit !== null ? state.settings.lowerLimit : colA.lower };
  const effB = { ...colB, upper: state.settings.upperLimit !== null ? state.settings.upperLimit : colB.upper, lower: state.settings.lowerLimit !== null ? state.settings.lowerLimit : colB.lower };
  const rawA = state.datasetA.rows.map((r) => r[idxA] ?? 'NA');
  const rawB = state.datasetB.rows.map((r) => r[idxB] ?? 'NA');
  const pair = analyzeColumnPair(effA, rawA, effB, rawB, state.settings.binCount, state.settings.lowerRange, state.settings.upperRange, state.settings.showLimits);
  return { idxA, idxB, pair };
}

export default useOppStore;
