import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  clearColumnCache,
  parseOppDataset,
  uploadOppFile,
  type ParsedDataset,
} from '../lib/dataset';
import { DEFAULT_CHART_SETTINGS, type ChartSettings } from '../lib/stats';

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

/** 累加模式的一组规格限；按 `uploadId:测试项` 分组存放，导出报告时也会读取。 */
export interface AccumulatedLimit {
  id: string;
  upper: number | null;
  lower: number | null;
}

export const accumulatedKey = (uploadId: string, name: string): string => `${uploadId}:${name}`;

const MAX_ACCUMULATED_LIMITS = 20;

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
  /** 切换测试项后按列统计/分箱的重算进行中（大文件下这一步是同步阻塞的） */
  computing: boolean;
  error: string;
  selectedName: string;
  query: string;
  corrYName: string;
  chartType: ChartType;
  settings: ChartSettings;
  excludeFail: boolean;
  /** 累加模式的规格限组合，键为 `accumulatedKey(uploadId, 测试项)` */
  accumulatedLimits: Record<string, AccumulatedLimit[]>;
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
  setComputing: (v: boolean) => void;
  setError: (v: string) => void;
  setSelectedName: (v: string) => void;
  setQuery: (v: string) => void;
  setCorrYName: (v: string) => void;
  setChartType: (v: ChartType) => void;
  updateSetting: <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => void;
  setSettings: (s: ChartSettings) => void;
  setExcludeFail: (v: boolean) => void;
  addAccumulatedLimit: (key: string, limit: { upper: number | null; lower: number | null }) => void;
  removeAccumulatedLimit: (key: string, id: string) => void;
  clearAccumulatedLimits: (key: string) => void;
  /** 迁移自 index.tsx 的 handleFileA/B */
  loadFileA: (file: File) => Promise<void>;
  loadFileB: (file: File) => Promise<void>;
  clearFileA: () => void;
  clearFileB: () => void;
  reset: () => void;
}

export type OppStore = OppState & OppActions;

/**
 * 统一的测试项选择更新：选中值变化时清除手动 Upper/Lower Range，
 * 回落到新测试项的自动计算值。所有选择路径（列表点击、文件加载自动选中）共用。
 */
function applyItemSelection(
  state: OppState,
  name: string,
): Partial<OppState> {
  if (name === state.selectedName) return { selectedName: name };
  return {
    selectedName: name,
    settings: { ...state.settings, upperRange: null, lowerRange: null },
  };
}

/** 测试项切换序号：连点时只让最后一次生效，避免排队跑多次全量统计。 */
let selectionSeq = 0;

/** 让加载层先上屏再切测试项。双击 rAF 保证至少绘制过一帧；后台标签页不跑 rAF 时用定时器兜底。 */
function afterNextPaint(run: () => void): void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    run();
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(fire);
  });
  window.setTimeout(fire, 200);
}

let uploadAbortA: (() => void) | null = null;
let uploadAbortB: (() => void) | null = null;

function startUpload(
  file: File,
  onProgress: (percent: number) => void,
): { promise: Promise<string>; abort: () => void } {
  let abort = () => {};
  const promise = new Promise<string>((resolve, reject) => {
    abort = uploadOppFile(file, { onProgress, onSuccess: resolve, onError: reject });
  });
  return { promise, abort };
}

// WeakMap 键占位（无数据集时的稳定引用）
const EMPTY_DATASET: ParsedDataset = {
  uploadId: '',
  title: '',
  records: 0,
  columns: [],
  skippedColumns: [],
  allColumns: [],
  hasFailRecords: false,
  statusPass: null,
  headerRowIndex: -1,
  dataStartRow: 0,
  snColumn: null,
  startTimeColumn: null,
  endTimeColumn: null,
  lowerLimitRow: null,
  upperLimitRow: null,
  unitRow: null,
};

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
  computing: false,
  error: '',
  selectedName: '',
  query: '',
  corrYName: '',
  chartType: 'histogram',
  settings: { ...DEFAULT_CHART_SETTINGS },
  excludeFail: true,
  accumulatedLimits: {},
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
        const state = get();
        if (ds && ds.columns.length > 0) {
          const exists = ds.columns.some((c) => c.name === state.selectedName);
          if (!state.selectedName || !exists) {
            // 若 B 也存在则以并集首项为准，单纯 A 则取 A 首项
            const first = ds.columns[0].name;
            set(applyItemSelection(state, first));
          }
        }
      },
      setDatasetB: (ds) => set({ datasetB: ds }),
      setCompareMode: (v) => set({ compareMode: v }),
      setLoading: (v) => set({ loading: v }),
      setProgress: (v) => set({ progress: v }),
      setComputing: (v) => set({ computing: v }),
      setError: (v) => set({ error: v }),
      setSelectedName: (v) => {
        if (v === get().selectedName) return;
        const seq = ++selectionSeq;
        // 大文件下按列统计/分箱是同步计算：先显示加载层，下一帧再切测试项，避免点下去像卡死
        set({ computing: true });
        afterNextPaint(() => {
          if (seq !== selectionSeq) return;
          set((s) => applyItemSelection(s, v));
        });
      },
      setQuery: (v) => set({ query: v }),
      setCorrYName: (v) => set({ corrYName: v }),
      setChartType: (v) => set({ chartType: v }),
      updateSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setSettings: (s) => set({ settings: s }),
      setExcludeFail: (v) => set({ excludeFail: v }),
      addAccumulatedLimit: (key, limit) =>
        set((s) => {
          const current = s.accumulatedLimits[key] ?? [];
          if (current.length >= MAX_ACCUMULATED_LIMITS) return s;
          if (current.some((e) => e.upper === limit.upper && e.lower === limit.lower)) return s;
          return {
            accumulatedLimits: {
              ...s.accumulatedLimits,
              [key]: [...current, { ...limit, id: `${Date.now()}-${current.length}` }],
            },
          };
        }),
      removeAccumulatedLimit: (key, id) =>
        set((s) => {
          const current = s.accumulatedLimits[key];
          if (!current) return s;
          return {
            accumulatedLimits: { ...s.accumulatedLimits, [key]: current.filter((e) => e.id !== id) },
          };
        }),
      clearAccumulatedLimits: (key) =>
        set((s) => {
          if (!s.accumulatedLimits[key]) return s;
          const next = { ...s.accumulatedLimits };
          delete next[key];
          return { accumulatedLimits: next };
        }),
      loadFileA: async (file: File) => {
        uploadAbortA?.();
        set({ error: '', fileA: file, loading: true, progress: 0, fileNameA: file.name });
        const upload = startUpload(file, (percent) => set({ progress: percent / 100 }));
        uploadAbortA = upload.abort;
        try {
          const uploadId = await upload.promise;
          const ds = await parseOppDataset(uploadId, file.name);
          clearColumnCache(uploadId);
          set({ datasetA: ds, progress: 1 });
          // 自动选中首项（若当前未选中或不存在）
          const state = get();
          const exists = ds.columns.some((c) => c.name === state.selectedName);
          if (!state.selectedName || !exists) set(applyItemSelection(state, ds.columns[0]?.name ?? ''));
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'CSV 解析失败' });
        } finally {
          if (uploadAbortA === upload.abort) uploadAbortA = null;
          set({ loading: false });
        }
      },
      loadFileB: async (file: File) => {
        uploadAbortB?.();
        set({ error: '', fileB: file, loading: true, progress: 0, fileNameB: file.name });
        const upload = startUpload(file, (percent) => set({ progress: percent / 100 }));
        uploadAbortB = upload.abort;
        try {
          const uploadId = await upload.promise;
          const ds = await parseOppDataset(uploadId, file.name);
          clearColumnCache(uploadId);
          set({ datasetB: ds, progress: 1 });
          // 与 loadFileA 相同的兜底选择：仅加载 B（或 A 已清空）时自动选中首项
          const state = get();
          const exists = ds.columns.some((c) => c.name === state.selectedName);
          if (!state.selectedName || !exists) set(applyItemSelection(state, ds.columns[0]?.name ?? ''));
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'CSV 解析失败' });
        } finally {
          if (uploadAbortB === upload.abort) uploadAbortB = null;
          set({ loading: false });
        }
      },
      clearFileA: () => {
        uploadAbortA?.();
        uploadAbortA = null;
        const current = get().datasetA;
        if (current?.uploadId) {
          clearColumnCache(current.uploadId);
          set((s) => ({
            accumulatedLimits: Object.fromEntries(
              Object.entries(s.accumulatedLimits).filter(([k]) => !k.startsWith(`${current.uploadId}:`)),
            ),
          }));
        }
        set({ fileA: null, datasetA: null, fileNameA: '', progress: 0 });
      },
      clearFileB: () => {
        uploadAbortB?.();
        uploadAbortB = null;
        const current = get().datasetB;
        if (current?.uploadId) {
          clearColumnCache(current.uploadId);
          set((s) => ({
            accumulatedLimits: Object.fromEntries(
              Object.entries(s.accumulatedLimits).filter(([k]) => !k.startsWith(`${current.uploadId}:`)),
            ),
          }));
        }
        set({ fileB: null, datasetB: null, fileNameB: '', progress: 0 });
      },
      reset: () => {
        uploadAbortA?.();
        uploadAbortB?.();
        uploadAbortA = null;
        uploadAbortB = null;
        const { datasetA, datasetB } = get();
        if (datasetA?.uploadId) clearColumnCache(datasetA.uploadId);
        if (datasetB?.uploadId) clearColumnCache(datasetB.uploadId);
        set({ ...initialState, settings: { ...DEFAULT_CHART_SETTINGS }, accumulatedLimits: {} });
      },
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
        excludeFail: state.excludeFail,
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

export default useOppStore;
