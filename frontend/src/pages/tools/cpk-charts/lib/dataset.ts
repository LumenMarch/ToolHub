// OPP 数据集：后端解析 + 按列懒加载。
//
// 文件先经 tus 上传到后端，由 Polars 解析并以 Parquet 缓存；前端只拿
// 元数据与当前测试项的列数据（Float64Array + 非空标记），统计与绘图仍在
// 本进程完成，避免把整张表以 JSON 回传。
import * as tus from 'tus-js-client';

import api from '@/api/axios';
import {
  analyzeColumn,
  analyzeColumnPair,
  makeColumn,
  shortName,
  type ChartSettings,
  type ColumnAnalysis,
  type ColumnValues,
  type CorrelationPair,
  type TestColumn,
} from './stats';

export interface ParsedDataset {
  uploadId: string;
  title: string;
  records: number;
  columns: TestColumn[];
  skippedColumns: string[];
  allColumns: string[];
  hasFailRecords: boolean;
  /** 1 = PASS/空（可计入过滤后的样本）；null = 文件没有状态列 */
  statusPass: Uint8Array | null;
  headerRowIndex: number;
  dataStartRow: number;
  snColumn: number | null;
  startTimeColumn: number | null;
  endTimeColumn: number | null;
  lowerLimitRow: number | null;
  upperLimitRow: number | null;
  unitRow: number | null;
}

interface CpkParseResponse {
  upload_id: string;
  title: string;
  records: number;
  columns: Array<{ name: string; unit: string; upper: string; lower: string }>;
  all_columns: string[];
  skipped_columns: string[];
  has_fail_records: boolean;
  status_pass: string | null;
  header_row_index: number;
  data_start_row: number;
  sn_column: number | null;
  start_time_column: number | null;
  end_time_column: number | null;
  lower_limit_row: number | null;
  upper_limit_row: number | null;
  unit_row: number | null;
}

const TUS_ENDPOINT = '/api/v1/upload/tus';
const CHUNK_SIZE = 5 * 1024 * 1024;

export interface UploadHooks {
  onProgress?: (percent: number) => void;
  onSuccess: (uploadId: string) => void;
  onError: (error: Error) => void;
}

/** 把文件传到后端 tus 端点，返回取消函数。 */
export function uploadOppFile(file: File, hooks: UploadHooks): () => void {
  const upload = new tus.Upload(file, {
    endpoint: TUS_ENDPOINT,
    chunkSize: CHUNK_SIZE,
    metadata: {
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
    },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    storeFingerprintForResuming: false,
    onProgress(bytesUploaded, bytesTotal) {
      if (bytesTotal > 0) hooks.onProgress?.(Math.floor((bytesUploaded / bytesTotal) * 100));
    },
    onSuccess(payload) {
      const url = upload.url || payload?.lastResponse?.getHeader('Location') || '';
      const uploadId = url.split('?')[0].split('/').filter(Boolean).pop() ?? '';
      if (!uploadId) {
        hooks.onError(new Error('上传完成但未拿到 upload id'));
        return;
      }
      hooks.onSuccess(uploadId);
    },
    onError(error) {
      hooks.onError(error instanceof Error ? error : new Error(String(error)));
    },
  });
  upload.start();
  return () => {
    void upload.abort(true).catch(() => undefined);
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 请求后端解析（首次解析较慢，之后命中服务端 Parquet 缓存）。 */
export async function parseOppDataset(uploadId: string, fileName: string): Promise<ParsedDataset> {
  const response = await api.post<CpkParseResponse>('/tools/cpk-charts/parse', {
    upload_id: uploadId,
  });
  const data = response.data;
  return {
    uploadId,
    title: data.title || fileName,
    records: data.records,
    columns: data.columns.map((c) => makeColumn(c.name, c.unit, c.upper, c.lower)),
    skippedColumns: data.skipped_columns,
    allColumns: data.all_columns,
    hasFailRecords: data.has_fail_records,
    statusPass: data.status_pass ? decodeBase64(data.status_pass) : null,
    headerRowIndex: data.header_row_index,
    dataStartRow: data.data_start_row,
    snColumn: data.sn_column,
    startTimeColumn: data.start_time_column,
    endTimeColumn: data.end_time_column,
    lowerLimitRow: data.lower_limit_row,
    upperLimitRow: data.upper_limit_row,
    unitRow: data.unit_row,
  };
}

const columnCache = new Map<string, Promise<ColumnValues>>();

/** 取一列数据（含非空标记）；失败会从缓存移除，允许重试。 */
export function loadColumn(dataset: ParsedDataset, index: number): Promise<ColumnValues> {
  const key = `${dataset.uploadId}:${index}`;
  const cached = columnCache.get(key);
  if (cached) return cached;
  const pending = fetchColumn(dataset.uploadId, index);
  columnCache.set(key, pending);
  pending.catch(() => columnCache.delete(key));
  return pending;
}

async function fetchColumn(uploadId: string, index: number): Promise<ColumnValues> {
  const response = await api.get(`/tools/cpk-charts/column/${uploadId}/${index}`, {
    responseType: 'arraybuffer',
  });
  const buffer = response.data as ArrayBuffer;
  const count = new DataView(buffer).getUint32(0, true);
  // Float64Array 要求 8 字节对齐：从偏移 4 复制一份再建视图
  const values = new Float64Array(buffer.slice(4, 4 + count * 8));
  const nonEmpty = new Uint8Array(buffer, 4 + count * 8, count);
  return { values, nonEmpty };
}

export function clearColumnCache(uploadId: string): void {
  for (const key of [...columnCache.keys()]) {
    if (key.startsWith(`${uploadId}:`)) columnCache.delete(key);
  }
}

function effectiveColumn(column: TestColumn, settings: ChartSettings): TestColumn {
  return {
    ...column,
    upper: settings.upperLimit !== null ? settings.upperLimit : column.upper,
    lower: settings.lowerLimit !== null ? settings.lowerLimit : column.lower,
  };
}

export interface ActiveAnalysis {
  index: number;
  analysis: ColumnAnalysis;
}

export async function loadActive(
  dataset: ParsedDataset | null,
  name: string,
  settings: ChartSettings,
  excludeFail: boolean,
): Promise<ActiveAnalysis | null> {
  if (!dataset || !name) return null;
  const index = dataset.columns.findIndex((c) => c.name === name);
  if (index < 0) return null;
  const data = await loadColumn(dataset, index);
  return {
    index,
    analysis: analyzeColumn(
      effectiveColumn(dataset.columns[index], settings),
      data,
      excludeFail ? dataset.statusPass : null,
      settings.binCount,
      settings.lowerRange,
      settings.upperRange,
      settings.showLimits,
    ),
  };
}

export interface SharedPairAnalysis {
  indexA: number;
  indexB: number;
  pair: { a: ColumnAnalysis; b: ColumnAnalysis };
}

export async function loadSharedPair(
  datasetA: ParsedDataset | null,
  datasetB: ParsedDataset | null,
  name: string,
  settings: ChartSettings,
  excludeFail: boolean,
): Promise<SharedPairAnalysis | null> {
  if (!datasetA || !datasetB || !name) return null;
  const indexA = datasetA.columns.findIndex((c) => c.name === name);
  const indexB = datasetB.columns.findIndex((c) => c.name === name);
  if (indexA < 0 || indexB < 0) return null;
  const [dataA, dataB] = await Promise.all([
    loadColumn(datasetA, indexA),
    loadColumn(datasetB, indexB),
  ]);
  const pair = analyzeColumnPair(
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
  return { indexA, indexB, pair };
}

export async function loadCorrelation(
  dataset: ParsedDataset | null,
  xName: string,
  yName: string,
  settings: ChartSettings,
  excludeFail: boolean,
): Promise<CorrelationPair | null> {
  if (!dataset || !xName || !yName) return null;
  const ix = dataset.columns.findIndex((c) => c.name === xName);
  const iy = dataset.columns.findIndex((c) => c.name === yName);
  if (ix < 0 || iy < 0) return null;
  const [dataX, dataY] = await Promise.all([
    loadColumn(dataset, ix),
    loadColumn(dataset, iy),
  ]);
  const colX = effectiveColumn(dataset.columns[ix], settings);
  const colY = dataset.columns[iy];
  return {
    xName: shortName(xName),
    yName: shortName(yName),
    valuesX: dataX.values,
    valuesY: dataY.values,
    nonEmptyX: dataX.nonEmpty,
    nonEmptyY: dataY.nonEmpty,
    includeMask: excludeFail ? dataset.statusPass : null,
    xUpper: colX.upper,
    xLower: colX.lower,
    yUpper: colY.upper,
    yLower: colY.lower,
  };
}
