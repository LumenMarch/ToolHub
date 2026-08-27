// 产线测试导出 CSV 解析器 — 对齐 DataController.getTestItems / merge_csv.pl 语义
// 支持：
// 1. WiPAS 产线格式：headerRow (Serial Number|Product|Site) + limit rows (Upper/Lower Limit) + Measurement Unit 行 + 数据行
// 2. 通用 CSV：首行即表头，无规格限
import { makeColumn, parseCell, type TestColumn } from './stats';

export interface ParsedDataset {
  title: string;
  records: number;
  columns: TestColumn[];
  rows: string[][];
  skippedColumns: string[];
  /** 完整表头列名（按表格顺序，含数值与文本列） */
  allColumns: string[];
  /** 扩展元数据：对齐 DataController */
  headerRowIndex?: number;
  dataStartRow?: number;
  snColumn?: number;
  startTimeColumn?: number;
  endTimeColumn?: number;
  lowerLimitRow?: number;
  upperLimitRow?: number;
  unitRow?: number;
}

const NA_TOKENS_LOWER: Record<string, true> = { '': true, na: true, 'n/a': true, none: true, null: true };

function normalizeCell(v: string): string {
  const t = v.trim();
  if (t.length === 0) return 'NA';
  const low = t.toLowerCase();
  if (NA_TOKENS_LOWER[low]) return 'NA';
  return t;
}

function isNAToken(v: string): boolean {
  return !!NA_TOKENS_LOWER[v.trim().toLowerCase()];
}

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
      // ignore, CRLF
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || current.length > 0) {
    flushRow();
  }
  return rows.filter((row) => row.some((cell) => cell.trim() !== ''));
}

function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i += 1) {
    const first = (rows[i][0] || '').trim();
    if (/Serial\s*Number/i.test(first) || /Product/i.test(first) || /^Site$/i.test(first) || /Site/i.test(rows[i].join(','))) {
      // 更严格：整行中任意列匹配三者之一
      const rowStr = rows[i].join('|');
      if (/Serial\s*Number/i.test(rowStr) || /\bProduct\b/i.test(rowStr) || /\bSite\b/i.test(rowStr)) return i;
    }
    // 首列精确等于 Site 的旧逻辑兼容
    if (first === 'Site') return i;
  }
  return -1;
}

function findUnitRow(rows: string[][], headerIdx: number): number {
  const end = Math.min(rows.length, headerIdx + 12);
  for (let i = headerIdx + 1; i < end; i += 1) {
    const row = rows[i] || [];
    for (let c = 0; c < Math.min(row.length, 4); c += 1) {
      const cell = (row[c] || '').trim();
      if (/Measurement\s*Unit/i.test(cell)) return i;
    }
    // 也扫描整行
    if (row.some((cell) => /Measurement\s*Unit/i.test(cell))) return i;
  }
  return -1;
}

function findLimitRows(rows: string[][], headerIdx: number): { lower: number; upper: number } {
  let lower = -1;
  let upper = -1;
  const end = Math.min(rows.length, headerIdx + 12);
  for (let i = headerIdx + 1; i < end; i += 1) {
    const first = (rows[i][0] || '').trim();
    const joined = rows[i].join(' ');
    if (/Lower\s*Limit/i.test(first) || /Lower\s*Limit/i.test(joined)) lower = i;
    if (/Upper\s*Limit/i.test(first) || /Upper\s*Limit/i.test(joined)) upper = i;
  }
  return { lower, upper };
}

function findColumnIndices(headerRow: string[]): { sn: number; startTime: number; endTime: number } {
  let sn = -1;
  let startTime = -1;
  let endTime = -1;
  for (let i = 0; i < headerRow.length; i += 1) {
    const h = headerRow[i].trim();
    if (sn < 0 && /Serial\s*Number/i.test(h)) sn = i;
    if (startTime < 0 && /Start\s*Time/i.test(h)) startTime = i;
    if (endTime < 0 && /End\s*Time/i.test(h)) endTime = i;
  }
  return { sn, startTime, endTime };
}

/**
 * 解析测试数据 CSV — 对齐 DataController.getTestItems
 * - headerRow 识别：Serial Number|Product|Site
 * - dataStartRow：最后一元数据行（unit/limit）之后的下一行
 * - limitRow：Lower/Upper Limit 扫描
 * - snColumn/startTimeColumn 定位
 * - NA/N/A/None/空串归一为 NA (null 数值)
 */
export function parseTestCsv(text: string, fileName?: string): ParsedDataset {
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new Error('文件内容为空');

  const headerIdx = findHeaderRow(rows);
  let unitRowIdx = -1;
  let lowerRowIdx = -1;
  let upperRowIdx = -1;
  let dataStart = -1;

  if (headerIdx >= 0) {
    unitRowIdx = findUnitRow(rows, headerIdx);
    const limits = findLimitRows(rows, headerIdx);
    lowerRowIdx = limits.lower;
    upperRowIdx = limits.upper;
    dataStart = headerIdx + 1;
    // 数据行从最后一元数据行之后的第一非元数据行开始（Upper/Lower Limit、Measurement Unit 均不属于数据）
    const lastMeta = Math.max(unitRowIdx, lowerRowIdx, upperRowIdx);
    if (lastMeta >= headerIdx) {
      for (let i = lastMeta + 1; i < Math.min(rows.length, lastMeta + 12); i += 1) {
        const first = (rows[i][0] || '').trim();
        if (
          first.length === 0 ||
          /Upper\s*Limit/i.test(first) ||
          /Lower\s*Limit/i.test(first) ||
          /Measurement\s*Unit/i.test(first) ||
          /Display\s*Name/i.test(first) ||
          /PDCA\s*Priority/i.test(first)
        ) {
          continue;
        }
        dataStart = i;
        break;
      }
    }
  } else {
    // 通用 CSV：首行即表头
    dataStart = 1;
  }

  // 标题：取 header 上一行前 3 非空单元格拼接，或 fileName
  let title = '';
  if (headerIdx > 0) {
    const titleParts: string[] = [];
    for (const cell of rows[headerIdx - 1] || []) {
      const t = cell.trim();
      if (t) titleParts.push(t);
    }
    if (titleParts.length > 0) title = titleParts.slice(0, 3).join(' / ');
  }
  if (!title) title = fileName || '未命名数据集';

  // findHeaderRow 未命中时回退首行为表头：保证通用 CSV（无 Site/Product 标记）也能解析出列
  const headerRow = (headerIdx >= 0 ? rows[headerIdx] : rows[0]) || [];
  const unitRow = unitRowIdx >= 0 ? rows[unitRowIdx] : null;
  const upperRow = upperRowIdx >= 0 ? rows[upperRowIdx] : null;
  const lowerRow = lowerRowIdx >= 0 ? rows[lowerRowIdx] : null;

  const { sn: snCol, startTime: stCol, endTime: etCol } = findColumnIndices(headerRow);

  const columns: TestColumn[] = [];
  const keptIdx: number[] = [];
  const skipped: string[] = [];

  const candidate: Array<{ idx: number; name: string; unit: string; upper: string; lower: string }> = [];
  for (let i = 0; i < headerRow.length; i += 1) {
    const name = headerRow[i].trim();
    if (!name) continue;
    const cellAt = (row: string[] | null): string => {
      if (!row) return 'NA';
      const v = (row[i] || '').trim();
      return v.length === 0 ? 'NA' : v;
    };
    candidate.push({ idx: i, name, unit: cellAt(unitRow), upper: cellAt(upperRow), lower: cellAt(lowerRow) });
  }

  // 数据行预取（用于判断列是否有数值）
  const rawDataRows: string[][] = [];
  for (let r = dataStart; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row.some((cell) => cell.trim() !== '')) continue;
    rawDataRows.push(row);
  }

  for (const c of candidate) {
    // 检查该列是否存在至少一个可解析数值；若全 NA/非数值则归入 skipped
    let hasNumeric = false;
    for (const row of rawDataRows) {
      const raw = (row[c.idx] || '').trim();
      if (raw.length === 0 || isNAToken(raw)) continue;
      const n = parseCell(raw);
      if (n !== null) { hasNumeric = true; break; }
    }
    if (!hasNumeric) {
      skipped.push(c.name);
      continue;
    }
    columns.push(makeColumn(c.name, c.unit, c.upper, c.lower));
    keptIdx.push(c.idx);
  }

  // 若过滤后为空（例如所有列均被判为无数值但实际是通用 CSV 数值列），回落为不过滤
  if (columns.length === 0 && candidate.length > 0 && rawDataRows.length > 0) {
    columns.length = 0;
    keptIdx.length = 0;
    skipped.length = 0;
    for (const c of candidate) {
      columns.push(makeColumn(c.name, c.unit, c.upper, c.lower));
      keptIdx.push(c.idx);
    }
  }

  const dataRows: string[][] = [];
  for (const row of rawDataRows) {
    dataRows.push(keptIdx.map((i) => normalizeCell(row[i] || '')));
  }

  return {
    title,
    records: dataRows.length,
    columns,
    rows: dataRows,
    skippedColumns: skipped,
    allColumns: headerRow.flatMap((h) => {
      const trimmed = h.trim();
      return trimmed ? [trimmed] : [];
    }),
    headerRowIndex: headerIdx,
    dataStartRow: dataStart,
    snColumn: snCol >= 0 ? snCol : undefined,
    startTimeColumn: stCol >= 0 ? stCol : undefined,
    endTimeColumn: etCol >= 0 ? etCol : undefined,
    lowerLimitRow: lowerRowIdx >= 0 ? lowerRowIdx : undefined,
    upperLimitRow: upperRowIdx >= 0 ? upperRowIdx : undefined,
    unitRow: unitRowIdx >= 0 ? unitRowIdx : undefined,
  };
}
