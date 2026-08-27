// Item Check 报告导出：按勾选 Item 生成三列 .numbers（Item | 数据A图 | 数据B图），表头为文件名
import api from '../../../../api/axios';
import { analyzeColumn, analyzeColumnPair, type ChartSettings } from './stats';
import { renderCdfSvg, renderHistogramSvg, renderTimeSeriesSvg, svgToPng } from './export';
import type { ParsedDataset } from './csv';

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
function renderSvgFor(analysis: ReturnType<typeof analyzeColumn>, settings: ChartSettings, view: ReportView): string {
  if (view === 'cdf') return renderCdfSvg(analysis, settings);
  if (view === 'timeseries') return renderTimeSeriesSvg(analysis, settings);
  return renderHistogramSvg(analysis, settings);
}

export async function buildItemCheckImages(
  datasetA: ParsedDataset | null,
  datasetB: ParsedDataset | null,
  names: string[],
  settings: ChartSettings,
  onProgress?: (done: number, total: number) => void,
  view: ReportView = 'histogram',
): Promise<{ imagesA: string[]; imagesB: string[] }> {
  const total = names.length;
  const imagesA: string[] = new Array(total).fill('');
  const imagesB: string[] = new Array(total).fill('');

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
          const colA0 = datasetA.columns[idxA];
          const colB0 = datasetB.columns[idxB];
          const effA = { ...colA0, upper: settings.upperLimit !== null ? settings.upperLimit : colA0.upper, lower: settings.lowerLimit !== null ? settings.lowerLimit : colA0.lower };
          const effB = { ...colB0, upper: settings.upperLimit !== null ? settings.upperLimit : colB0.upper, lower: settings.lowerLimit !== null ? settings.lowerLimit : colB0.lower };
          const rawA = datasetA.rows.map((r) => r[idxA] ?? 'NA');
          const rawB = datasetB.rows.map((r) => r[idxB] ?? 'NA');
          const pair = analyzeColumnPair(effA, rawA, effB, rawB, settings.binCount, settings.lowerRange, settings.upperRange);
          const svgA = renderSvgFor(pair.a, settings, view);
          const svgB = renderSvgFor(pair.b, settings, view);
          const [pngA, pngB] = await Promise.all([svgToPng(svgA), svgToPng(svgB)]);
          imagesA[pos] = await blobToBase64(pngA);
          imagesB[pos] = await blobToBase64(pngB);
          return;
        }
        // 单侧或仅一侧有该 Item，回退为单列分析
        if (hasA && datasetA) {
          const col = datasetA.columns[idxA];
          const eff = { ...col, upper: settings.upperLimit !== null ? settings.upperLimit : col.upper, lower: settings.lowerLimit !== null ? settings.lowerLimit : col.lower };
          const raw = datasetA.rows.map((r) => r[idxA] ?? 'NA');
          const analysis = analyzeColumn(eff, raw, settings.binCount, settings.lowerRange, settings.upperRange);
          const svg = renderSvgFor(analysis, settings, view);
          const png = await svgToPng(svg);
          imagesA[pos] = await blobToBase64(png);
        }
        if (hasB && datasetB) {
          const col = datasetB.columns[idxB];
          const eff = { ...col, upper: settings.upperLimit !== null ? settings.upperLimit : col.upper, lower: settings.lowerLimit !== null ? settings.lowerLimit : col.lower };
          const raw = datasetB.rows.map((r) => r[idxB] ?? 'NA');
          const analysis = analyzeColumn(eff, raw, settings.binCount, settings.lowerRange, settings.upperRange);
          const svg = renderSvgFor(analysis, settings, view);
          const png = await svgToPng(svg);
          imagesB[pos] = await blobToBase64(png);
        }
      }),
    );
    done += batch.length;
    onProgress?.(done, total);
  }
  return { imagesA, imagesB };
}

export type ItemCheckExportParams = {
  items: string[];
  fileNameA: string;
  fileNameB?: string | null;
  imagesA: string[];
  imagesB?: string[] | null;
};

/** 调用后端生成 .numbers 并触发下载 */
export async function exportItemCheckReport(params: ItemCheckExportParams): Promise<string> {
  const payload = {
    items: params.items,
    fileNameA: params.fileNameA,
    fileNameB: params.fileNameB || '',
    imagesA: params.imagesA,
    imagesB: params.imagesB || params.items.map(() => ''),
  };
  const resp = await api.post('/tools/cpk-charts/item-check-report', payload, {
    responseType: 'blob',
  });
  const blob: Blob = resp.data;
  const disposition = resp.headers['content-disposition'] as string | undefined;
  let filename = 'Item_Check.numbers';
  if (disposition) {
    const m = disposition.match(/filename="(.+?)"/) || disposition.match(/filename\*=UTF-8''(.+)/);
    if (m) filename = decodeURIComponent(m[1]);
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
