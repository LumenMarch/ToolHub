// 产线测试导出 CSV 解析器
// 支持两种输入：
// 1. 测试系统导出格式：标题行 + Site 表头 + 元数据行（Upper/Lower Limit、Measurement Unit）+ 数据行
// 2. 通用 CSV：首行即表头，无规格限（所有列规格限为 NA）
import { makeColumn, parseCell, type TestColumn } from './stats';

export interface ParsedDataset {
  /** 数据集名称（导出标题或文件名） */
  title: string;
  /** 数据记录数 */
  records: number;
  /** 有效数值测试项（按原列顺序） */
  columns: TestColumn[];
  /** 每行一条记录，单元格与 columns 对齐（空值用 NA） */
  rows: string[][];
  /** 被跳过的无数据列名 */
  skippedColumns: string[];
}

const HEADER_MARK = 'Site';
const UPPER_PREFIX = 'Upper Limit';
const LOWER_PREFIX = 'Lower Limit';
const UNIT_PREFIX = 'Measurement Unit';

/** 完整 CSV 文本解析（支持引号转义与 CRLF，无正则、单遍扫描）。 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  const flushField = () => {
    current.push(field);
    field = '';
  };
  const flushRow = () => {
    flushField();
    rows.push(current);
    current = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      flushField();
    } else if (ch === '\n') {
      flushRow();
    } else if (ch === '\r') {
      // 与 CRLF 配合，忽略
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || current.length > 0) {
    flushRow();
  }
  return rows.filter((row) => row.some((cell) => cell.trim() !== ''));
}

/**
 * 解析测试数据 CSV。
 * 找不到 Site 表头时按通用 CSV 处理（首行表头、无规格限）。
 */
export function parseTestCsv(text: string): ParsedDataset {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    throw new Error('文件内容为空');
  }

  // 定位 Site 表头行
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i += 1) {
    if (rows[i].length >= 3 && rows[i][0].trim() === HEADER_MARK) {
      headerIdx = i;
      break;
    }
  }

  let title = '';
  let upperRow: string[] | null = null;
  let lowerRow: string[] | null = null;
  let unitRow: string[] | null = null;
  let dataStart = -1;

  if (headerIdx >= 0) {
    if (headerIdx > 0) {
      const titleParts: string[] = [];
      for (const cell of rows[headerIdx - 1]) {
        const trimmed = cell.trim();
        if (trimmed) titleParts.push(trimmed);
      }
      if (titleParts.length > 0) title = titleParts.slice(0, 3).join(' / ');
    }
    // 表头后连续判定元数据行；其余为数据开始
    for (let i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 8); i += 1) {
      const first = (rows[i][0] || '').trim();
      if (first.startsWith(UPPER_PREFIX)) {
        upperRow = rows[i];
      } else if (first.startsWith(LOWER_PREFIX)) {
        lowerRow = rows[i];
      } else if (first.startsWith(UNIT_PREFIX)) {
        unitRow = rows[i];
      } else if (
        first.startsWith('Display Name') ||
        first.startsWith('PDCA Priority')
      ) {
        // 其他元数据行，跳过
      } else {
        dataStart = i;
        break;
      }
    }
    if (dataStart < 0) dataStart = headerIdx + 1;
  } else {
    // 通用 CSV：首行即表头
    headerIdx = 0;
    dataStart = 1;
    title = '未命名数据集';
  }
  if (!title) title = '未命名数据集';

  const headerRow = rows[headerIdx];
  const columns: TestColumn[] = [];
  const keptIdx: number[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < headerRow.length; i += 1) {
    const name = headerRow[i].trim();
    if (!name) continue;
    const cellAt = (row: string[] | null): string => {
      if (!row) return 'NA';
      const v = (row[i] || '').trim();
      return v || 'NA';
    };
    // 至少一个可解析数值才算有效测试项
    let valid = 0;
    for (let r = dataStart; r < rows.length; r += 1) {
      const v = (rows[r][i] || '').trim();
      if (parseCell(v) !== null) valid += 1;
      if (valid > 0) break;
    }
    if (valid > 0) {
      columns.push(makeColumn(name, cellAt(unitRow), cellAt(upperRow), cellAt(lowerRow)));
      keptIdx.push(i);
    } else {
      skipped.push(name);
    }
  }

  const dataRows: string[][] = [];
  for (let r = dataStart; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row.some((cell) => cell.trim() !== '')) continue;
    dataRows.push(keptIdx.map((i) => (row[i] || '').trim() || 'NA'));
  }

  return {
    title,
    records: dataRows.length,
    columns,
    rows: dataRows,
    skippedColumns: skipped,
  };
}

/** 从内置示例数据的字符串行构造数据集（数值不含逗号，可直接 split）。 */
export function datasetFromSample(
  title: string,
  colDefs: Array<{ name: string; unit: string; upper: string; lower: string }>,
  dataStrs: string[],
): ParsedDataset {
  return {
    title,
    records: dataStrs.length,
    columns: colDefs.map((c) => makeColumn(c.name, c.unit, c.upper, c.lower)),
    rows: dataStrs.map((line) => line.split(',')),
    skippedColumns: [],
  };
}

