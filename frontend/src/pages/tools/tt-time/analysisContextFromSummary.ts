/**
 * LLM analysisContext from backend-precomputed mean/percentiles/tail.
 * Never reconstructs fake tts from the five-number summary.
 */
import type { AnalysisContext, AnalysisStationCount, Bin, Stats } from './lib';

export const buildAnalysisContextFromSummary = (args: {
  fileName: string;
  stationFilter: string;
  totalRows: number;
  stats: Stats & { mean?: number };
  bins: Bin[];
  percentiles: AnalysisContext['percentiles'];
  tail: AnalysisContext['tail'];
  stationCounts: AnalysisStationCount[];
}): AnalysisContext => {
  const mean =
    args.stats.mean != null && Number.isFinite(args.stats.mean)
      ? Number(args.stats.mean)
      : 0;
  return {
    fileName: args.fileName,
    stationFilter: args.stationFilter,
    totalRows: args.totalRows,
    stats: { ...args.stats, mean },
    distribution: args.bins.map((b) => ({
      label: b.label,
      count: b.count,
      percent: Number(b.percent.toFixed(1)),
    })),
    percentiles: args.percentiles,
    tail: args.tail,
    stations: args.stationCounts,
  };
};
