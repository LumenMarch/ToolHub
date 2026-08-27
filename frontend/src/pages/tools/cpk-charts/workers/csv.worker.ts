// Web Worker — PapaParse 流式解析封装（chunk 1MB，ArrayBuffer → ParsedDataset）
// 主线程通过 postMessage({ id, buffer: ArrayBuffer, fileName }) 调用，
// Worker 回复 { id, type: 'progress'|'done'|'error', progress?, dataset?, error? }
/// <reference lib="webworker" />
import Papa from 'papaparse';
import { parseCsvRows, parseTestCsv } from '../lib/csv';

interface WorkerRequest {
  id: string;
  buffer: ArrayBuffer;
  fileName?: string;
}

interface WorkerProgress {
  id: string;
  type: 'progress';
  progress: number;
}
interface WorkerDone {
  id: string;
  type: 'done';
  dataset: unknown;
}
interface WorkerError {
  id: string;
  type: 'error';
  error: string;
}

type WorkerScope = {
  postMessage: (m: unknown) => void;
};

// WorkerGlobalScope 类型在 lib webworker 中已定义，此处以命名常量承载断言，避免内联成员访问
const workerScope = self as unknown as WorkerScope;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, buffer, fileName } = e.data;
  const post = (msg: WorkerProgress | WorkerDone | WorkerError) => {
    workerScope.postMessage(msg);
  };
  try {
    const text = new TextDecoder().decode(buffer);
    let totalChunks = Math.max(1, Math.ceil(text.length / (1024 * 1024)));
    let seen = 0;
    try {
      Papa.parse<string[]>(text, {
        chunkSize: 1024 * 1024,
        chunk: () => {
          seen += 1;
          const p = Math.min(0.9, seen / totalChunks);
          post({ id, type: 'progress', progress: p });
        },
        complete: () => {},
      });
    } catch {
      // Papa 异常不影响主解析
    }
    let dataset;
    try {
      dataset = parseTestCsv(text, fileName);
    } catch (err) {
      const papaRows = parseCsvRows(text);
      const rows = papaRows.filter((r) => r.some((c) => c.trim() !== ''));
      if (rows.length === 0) throw err;
      dataset = parseTestCsv(rows.map((r) => r.join(',')).join('\n'), fileName);
    }
    post({ id, type: 'progress', progress: 1 });
    post({ id, type: 'done', dataset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    post({ id, type: 'error', error: msg });
  }
};
