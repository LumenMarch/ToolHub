import type { AnalysisContext, Bin, Stats } from './lib';
import { buildAnalysisContextFromSummary } from './analysisContextFromSummary';

export type ProcessLike = {
  filteredRows: number;
  stats: Stats & { mean?: number };
  bins: Bin[];
  percentiles?: { p50: number; p90: number; p95: number; p99: number };
  tail?: { iqrThreshold: number; outlierCount: number; outlierPercent: number };
  stationBoxGroups?: { stationId: string; count: number }[];
};

export function makeAnalysisContext(
  processData: ProcessLike | null,
  fileName: string,
  station: string,
): AnalysisContext | null {
  if (!processData || processData.filteredRows === 0) return null;
  return buildAnalysisContextFromSummary({
    fileName,
    stationFilter: station,
    totalRows: processData.filteredRows,
    stats: processData.stats,
    bins: processData.bins,
    percentiles: processData.percentiles ?? { p50: 0, p90: 0, p95: 0, p99: 0 },
    tail: processData.tail ?? {
      iqrThreshold: 0,
      outlierCount: 0,
      outlierPercent: 0,
    },
    stationCounts: (processData.stationBoxGroups ?? []).map((g) => ({
      id: g.stationId,
      count: g.count,
    })),
  });
}
