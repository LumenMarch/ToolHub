// Item Check 报告导出：按勾选 Item 生成三列 .numbers（Item | 数据A图 | 数据B图），表头为文件名
import type { AxiosResponse } from 'axios';
import api from '../../../../api/axios';
import {
  analyzeColumn,
  analyzeColumnPair,
  type ChartSettings,
  type ColumnAnalysis,
  type TestColumn,
} from './stats';
import { renderCdfSvg, renderHistogramSvg, renderTimeSeriesSvg, svgToPng } from './export';
import { loadColumn, type ParsedDataset } from './dataset';
import { accumulatedKey, type AccumulatedLimit } from '../store/useOppStore';

const CONCURRENCY = 4;

/** Blob -> base64（不含 data: 前缀） */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  // 分块避免大数组一次拼接过长
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    bin += String.fromCharCode(...chunk);
  }
  return btoa(bin);
}

/**
 * 为指定 Item 列表生成两列 PNG 的 base64 数组（与 items 顺序一一对应）。
 * 无该 Item 的数据集对应项返回空字符串，保持占位。
 */
export type ReportView = 'histogram' | 'cdf' | 'timeseries';

/** 按视图类型选择 SVG 渲染器。 */
function renderSvgFor(analysis: ColumnAnalysis, settings: ChartSettings, view: ReportView): string {
  if (view === 'cdf') return renderCdfSvg(analysis, settings);
  if (view === 'timeseries') return renderTimeSeriesSvg(analysis, settings);
  return renderHistogramSvg(analysis, settings);
}

/** 有效列：手动规格限覆盖列自带的上下限。 */
function effectiveColumn(column: TestColumn, settings: ChartSettings): TestColumn {
  return {
    ...column,
    upper: settings.upperLimit !== null ? settings.upperLimit : column.upper,
    lower: settings.lowerLimit !== null ? settings.lowerLimit : column.lower,
  };
}

async function singleAnalysis(
  dataset: ParsedDataset,
  index: number,
  settings: ChartSettings,
  excludeFail: boolean,
): Promise<ColumnAnalysis> {
  const data = await loadColumn(dataset, index);
  return analyzeColumn(
    effectiveColumn(dataset.columns[index], settings),
    data,
    excludeFail ? dataset.statusPass : null,
    settings.binCount,
    settings.lowerRange,
    settings.upperRange,
    settings.showLimits,
  );
}

async function pairedAnalysis(
  datasetA: ParsedDataset,
  indexA: number,
  datasetB: ParsedDataset,
  indexB: number,
  settings: ChartSettings,
  excludeFail: boolean,
): Promise<{ a: ColumnAnalysis; b: ColumnAnalysis }> {
  const [dataA, dataB] = await Promise.all([
    loadColumn(datasetA, indexA),
    loadColumn(datasetB, indexB),
  ]);
  return analyzeColumnPair(
    effectiveColumn(datasetA.columns[indexA], settings),
    dataA,
    excludeFail ? datasetA.statusPass : null,
    effectiveColumn(datasetB.columns[indexB], settings),
    dataB,
    excludeFail ? datasetB.statusPass : null,
    settings.binCount,
    settings.lowerRange,
    settings.upperRange,
    settings.showLimits,
  );
}

export async function buildItemCheckImages(
  datasetA: ParsedDataset | null,
  datasetB: ParsedDataset | null,
  names: string[],
  settings: ChartSettings,
  onProgress?: (done: number, total: number) => void,
  view: ReportView = 'histogram',
  excludeFail?: boolean,
): Promise<{ imagesA: string[]; imagesB: string[] }> {
  const total = names.length;
  const imagesA: string[] = new Array(total).fill('');
  const imagesB: string[] = new Array(total).fill('');
  const filterFail = Boolean(excludeFail);

  let done = 0;
  for (let start = 0; start < total; start += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, total - start) }, (_, o) => start + o);
    await Promise.all(
      batch.map(async (pos) => {
        const name = names[pos];
        const idxA = datasetA ? datasetA.columns.findIndex((c) => c.name === name) : -1;
        const idxB = datasetB ? datasetB.columns.findIndex((c) => c.name === name) : -1;
        const hasA = idxA >= 0 && !!datasetA;
        const hasB = idxB >= 0 && !!datasetB;
        // 两侧均有该 Item 时，使用共享 X 轴域保证刻度完全一致
        if (hasA && hasB && datasetA && datasetB) {
          const pair = await pairedAnalysis(datasetA, idxA, datasetB, idxB, settings, filterFail);
          const [pngA, pngB] = await Promise.all([
            svgToPng(renderSvgFor(pair.a, settings, view)),
            svgToPng(renderSvgFor(pair.b, settings, view)),
          ]);
          [imagesA[pos], imagesB[pos]] = await Promise.all([
            blobToBase64(pngA),
            blobToBase64(pngB),
          ]);
          return;
        }
        // 单侧或仅一侧有该 Item，回退为单列分析
        if (hasA && datasetA) {
          const analysis = await singleAnalysis(datasetA, idxA, settings, filterFail);
          imagesA[pos] = await blobToBase64(await svgToPng(renderSvgFor(analysis, settings, view)));
        }
        if (hasB && datasetB) {
          const analysis = await singleAnalysis(datasetB, idxB, settings, filterFail);
          imagesB[pos] = await blobToBase64(await svgToPng(renderSvgFor(analysis, settings, view)));
        }
      }),
    );
    done += batch.length;
    onProgress?.(done, total);
  }
  return { imagesA, imagesB };
}

/**
 * 累加模式的附加列图片：每行一个测试项，每列一组规格限。
 * 测试项没有对应组合（或超出列数）时该格保持空字符串，报告里就是空白。
 */
export async function buildItemCheckExtraImages(
  dataset: ParsedDataset | null,
  names: string[],
  limits: Record<string, AccumulatedLimit[]>,
  columns: number,
  settings: ChartSettings,
  view: ReportView,
  excludeFail: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<string[][]> {
  const rows: string[][] = names.map(() => new Array<string>(columns).fill(''));
  if (!dataset || columns === 0) return rows;

  let done = 0;
  for (let start = 0; start < names.length; start += CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(CONCURRENCY, names.length - start) },
      (_, offset) => start + offset,
    );
    await Promise.all(
      batch.map(async (rowIndex) => {
        const name = names[rowIndex];
        const entries = limits[accumulatedKey(dataset.uploadId, name)] ?? [];
        const columnIndex = dataset.columns.findIndex((c) => c.name === name);
        if (columnIndex < 0 || entries.length === 0) return;
        const data = await loadColumn(dataset, columnIndex);
        const column = dataset.columns[columnIndex];
        const mask = excludeFail ? dataset.statusPass : null;
        const count = Math.min(columns, entries.length);
        // 同一测试项的累加图并行渲染，避免循环内逐个 await
        const cells = await Promise.all(
          Array.from({ length: count }, async (_, entryIndex) => {
            const entry = entries[entryIndex];
            const analysis = analyzeColumn(
              { ...column, upper: entry.upper, lower: entry.lower },
              data,
              mask,
              settings.binCount,
              settings.lowerRange,
              settings.upperRange,
              settings.showLimits,
            );
            return blobToBase64(await svgToPng(renderSvgFor(analysis, settings, view)));
          }),
        );
        rows[rowIndex] = [...cells, ...new Array<string>(columns - count).fill('')];
      }),
    );
    done += batch.length;
    onProgress?.(done, names.length);
  }
  return rows;
}

export type ItemCheckExportParams = {
  items: string[];
  fileNameA: string;
  fileNameB?: string | null;
  imagesA: string[];
  imagesB?: string[] | null;
  /** 累加模式追加列的表头（New_limits1…）与逐行图片矩阵 */
  extraHeaders?: string[];
  imagesExtra?: string[][];
};

/** 调用后端生成 .numbers 并触发下载 */
export async function exportItemCheckReport(params: ItemCheckExportParams): Promise<string> {
  const payload = {
    items: params.items,
    fileNameA: params.fileNameA,
    fileNameB: params.fileNameB || '',
    imagesA: params.imagesA,
    imagesB: params.imagesB || params.items.map(() => ''),
    extraHeaders: params.extraHeaders || [],
    imagesExtra: params.imagesExtra || [],
  };
  let resp: AxiosResponse<Blob>;
  try {
    resp = await api.post('/tools/cpk-charts/item-check-report', payload, {
      responseType: 'blob',
    });
  } catch (err) {
    // responseType: 'blob' 时后端错误详情也在 Blob 里，解析出 detail 供调用方展示
    const data = (err as { response?: { data?: unknown } })?.response?.data;
    if (data instanceof Blob) {
      let detail: string | undefined;
      try {
        const parsed = JSON.parse(await data.text()) as { detail?: string };
        detail = parsed.detail;
      } catch {
        /* 非 JSON 错误体：忽略并保留原始错误 */
      }
      if (detail) throw new Error(detail);
    }
    throw err;
  }
  const blob: Blob = resp.data;
  const disposition = resp.headers['content-disposition'] as string | undefined;
  let filename = 'Item_Check.numbers';
  if (disposition) {
    const m = disposition.match(/filename="(.+?)"/i) || disposition.match(/filename\*\s*=\s*utf-8''([^;]+)/i);
    if (m) {
      try {
        filename = decodeURIComponent(m[1]);
      } catch {
        // 无效百分号编码时退回原样，避免中断下载
        filename = m[1];
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return filename;
}
