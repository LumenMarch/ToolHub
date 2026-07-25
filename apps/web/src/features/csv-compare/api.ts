import { request } from "@/lib/http";

export interface CsvChange {
  field: string;
  before: string;
  after: string;
}

export interface CsvComparisonResult {
  files: {
    source: string;
    target: string;
  };
  summary: {
    sourceRows: number;
    targetRows: number;
    added: number;
    deleted: number;
    modified: number;
    unchanged: number;
  };
  metadata: {
    sourceEncoding: string;
    targetEncoding: string;
    primaryKey: string;
    comparedColumns: string[];
    sourceOnlyColumns: string[];
    targetOnlyColumns: string[];
    resultLimit: number;
  };
  added: Array<{ key: string; row: Record<string, string> }>;
  deleted: Array<{ key: string; row: Record<string, string> }>;
  modified: Array<{ key: string; changes: CsvChange[] }>;
}

export const csvCompareApi = {
  compare: (payload: FormData) =>
    request<CsvComparisonResult>("/api/tools/csv-compare", {
      method: "POST",
      body: payload,
    }),
};
