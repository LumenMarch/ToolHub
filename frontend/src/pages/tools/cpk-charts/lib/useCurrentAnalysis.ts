import { useEffect, useState } from 'react';

import {
  loadActive,
  loadCorrelation,
  loadSharedPair,
  type ActiveAnalysis,
  type ParsedDataset,
} from './dataset';
import type { ChartSettings, CorrelationPair } from './stats';

export interface CurrentAnalysis {
  a: ActiveAnalysis | null;
  b: ActiveAnalysis | null;
  pair: CorrelationPair | null;
}

interface CurrentAnalysisParams {
  datasetA: ParsedDataset | null;
  datasetB: ParsedDataset | null;
  selectedName: string;
  corrYName: string;
  settings: ChartSettings;
  compareMode: boolean;
  excludeFail: boolean;
  chartType: string;
  onError: (message: string) => void;
}

/** 导出页当前测试项（A/B 分析与相关散点）：列数据在后端，异步取回后按设置计算。 */
export function useCurrentAnalysis({
  datasetA,
  datasetB,
  selectedName,
  corrYName,
  settings,
  compareMode,
  excludeFail,
  chartType,
  onError,
}: CurrentAnalysisParams): CurrentAnalysis {
  const [current, setCurrent] = useState<CurrentAnalysis>({ a: null, b: null, pair: null });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const shared = compareMode
        ? await loadSharedPair(datasetA, datasetB, selectedName, settings, excludeFail)
        : null;
      const a = shared
        ? { index: shared.indexA, analysis: shared.pair.a }
        : await loadActive(datasetA, selectedName, settings, excludeFail);
      const b = shared
        ? { index: shared.indexB, analysis: shared.pair.b }
        : await loadActive(datasetB, selectedName, settings, excludeFail);
      const pair =
        chartType === 'correlation'
          ? ((await loadCorrelation(datasetA, selectedName, corrYName, settings, excludeFail)) ??
            (await loadCorrelation(datasetB, selectedName, corrYName, settings, excludeFail)))
          : null;
      if (!cancelled) setCurrent({ a, b, pair });
    };
    void run().catch((err: unknown) => {
      if (!cancelled) onError(err instanceof Error ? err.message : '测试项数据加载失败');
    });
    return () => {
      cancelled = true;
    };
  }, [datasetA, datasetB, selectedName, corrYName, settings, compareMode, excludeFail, chartType, onError]);

  return current;
}
