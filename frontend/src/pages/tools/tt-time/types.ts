import type { Bin, StationBoxGroup, Stats } from './lib';

export type Phase = 'upload' | 'analyzing' | 'ready';
export type ActiveModule = 'distribution' | 'boxplot' | 'comparison';

export interface BackendProcessResponse {
  filename: string;
  totalRows: number;
  filteredRows: number;
  stations: string[];
  stats: Stats & { mean?: number };
  bins: Bin[];
  cdf: { x: number; y: number }[];
  stationBoxGroups: StationBoxGroup[];
  comparisonTable: {
    stations: string[];
    stationNumerics: string[];
    rows: { label: '最大值' | 'Q3' | 'Med' | 'Q1' | '最小值'; values: Record<string, number> }[];
  };
  percentiles?: { p50: number; p90: number; p95: number; p99: number };
  tail?: {
    iqrThreshold: number;
    outlierCount: number;
    outlierPercent: number;
  };
  elapsedMs: number;
}

export interface AnalysisResult {
  advice: string;
  model: string;
  elapsedMs: number;
  error?: string | null;
}
