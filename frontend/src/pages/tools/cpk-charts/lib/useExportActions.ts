import { useState } from 'react';

import type { ParsedDataset } from './dataset';
import type { CurrentAnalysis } from './useCurrentAnalysis';
import {
  accumulatedKey,
  type AccumulatedLimit,
  type MergeItem,
} from '../store/useOppStore';
import type { ChartSettings } from './stats';
import { exportChartPng, exportComparedByName, exportCorrelationPng } from './export';
import {
  buildItemCheckExtraImages,
  buildItemCheckImages,
  exportItemCheckReport,
} from './itemCheckReport';

export type ExportState =
  | { kind: 'single' }
  | { kind: 'all'; done: number; total: number }
  | { kind: 'itemCheck'; done: number; total: number }
  | null;

interface ExportActionsParams {
  checkedNames: Set<string>;
  merged: MergeItem[];
  datasetA: ParsedDataset | null;
  datasetB: ParsedDataset | null;
  fileNameA: string;
  fileNameB: string;
  settings: ChartSettings;
  chartType: string;
  excludeFail: boolean;
  accumulatedLimits: Record<string, AccumulatedLimit[]>;
  current: CurrentAnalysis;
  onError: (message: string) => void;
}

/** 导出页的四个动作（当前图 / 相关图 / ZIP / .numbers 报告）与进度状态。 */
export function useExportActions({
  checkedNames,
  merged,
  datasetA,
  datasetB,
  fileNameA,
  fileNameB,
  settings,
  chartType,
  excludeFail,
  accumulatedLimits,
  current,
  onError,
}: ExportActionsParams) {
  const [exporting, setExporting] = useState<ExportState>(null);
  const activeA = current.a;
  const activeB = current.b;
  const hasBothDatasets = Boolean(datasetA && datasetB);

  const handleExportCurrent = async (): Promise<void> => {
    if (!activeA && !activeB) return;
    setExporting({ kind: 'single' });
    try {
      // 两个文件都存在时导出当前 Item 的两张图，用 A_/B_ 前缀区分来源
      if (activeA) await exportChartPng(activeA.analysis, settings, 'A');
      if (datasetB && activeB) await exportChartPng(activeB.analysis, settings, 'B');
    } catch (err) {
      onError(err instanceof Error ? err.message : '图片导出失败');
    } finally {
      setExporting(null);
    }
  };

  const handleExportCorrelation = async (): Promise<void> => {
    const pair = current.pair;
    if (!pair) return;
    setExporting({ kind: 'single' });
    try {
      await exportCorrelationPng(pair, settings);
    } catch (err) {
      onError(err instanceof Error ? err.message : '相关性图导出失败');
    } finally {
      setExporting(null);
    }
  };

  /** 批量导出勾选测试项的图片 ZIP：A / B / 双源合并。 */
  const handleExportImages = async (scope: 'A' | 'B' | 'all'): Promise<void> => {
    if (checkedNames.size === 0) return;
    const names = Array.from(checkedNames);
    const sources: Array<{ dataset: ParsedDataset; prefix: string }> = [];
    if (datasetA && scope !== 'B') sources.push({ dataset: datasetA, prefix: 'A' });
    if (datasetB && scope !== 'A') sources.push({ dataset: datasetB, prefix: 'B' });
    if (sources.length === 0) return;
    setExporting({ kind: 'all', done: 0, total: names.length });
    try {
      // 同名 Item 在双数据源下会产出多个文件：total 以导出器实际值为准，避免 2/1 之类的显示
      await exportComparedByName(
        sources,
        names,
        settings,
        (done, total) => setExporting({ kind: 'all', done, total }),
        excludeFail,
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : '批量导出失败');
    } finally {
      setExporting(null);
    }
  };

  /** 批量导出报告：A / B 单列报告或 A+B 合并报告。 */
  const handleExportReport = async (scope: 'A' | 'B' | 'merged'): Promise<void> => {
    if (checkedNames.size === 0) return;
    const names = merged.flatMap((m) => (checkedNames.has(m.name) ? [m.name] : []));
    if (names.length === 0) return;
    setExporting({ kind: 'itemCheck', done: 0, total: names.length });
    try {
      const view = chartType === 'cdf' || chartType === 'timeseries' ? chartType : 'histogram';
      const onProgress = (done: number) => setExporting({ kind: 'itemCheck', done, total: names.length });

      // 累加模式的列：取本次导出主数据集的累加组合，按测试项最多的一组决定列数
      const countExtras = (dataset: ParsedDataset | null): number => {
        if (!dataset) return 0;
        return names.reduce(
          (max, name) =>
            Math.max(max, accumulatedLimits[accumulatedKey(dataset.uploadId, name)]?.length ?? 0),
          0,
        );
      };
      const extrasDataset =
        scope === 'B'
          ? datasetB
          : countExtras(datasetA) > 0
            ? datasetA
            : countExtras(datasetB) > 0
              ? datasetB
              : (datasetA ?? datasetB);
      // 两个文件对比时报告只保留 数据A / 数据B，不追加累加列
      const comparingBoth = scope === 'merged' && Boolean(datasetA && datasetB);
      const extraColumns = comparingBoth ? 0 : countExtras(extrasDataset);
      const extraHeaders = Array.from({ length: extraColumns }, (_, i) => `New_limits${i + 1}`);
      const imagesExtra =
        extraColumns > 0 && extrasDataset
          ? await buildItemCheckExtraImages(
              extrasDataset,
              names,
              accumulatedLimits,
              extraColumns,
              settings,
              view,
              excludeFail,
            )
          : [];

      if (scope === 'B') {
        const { imagesB } = await buildItemCheckImages(
          null,
          datasetB,
          names,
          settings,
          onProgress,
          view,
          excludeFail,
        );
        await exportItemCheckReport({
          items: names,
          fileNameA: fileNameB || datasetB?.title || '数据 B',
          imagesA: imagesB,
          extraHeaders,
          imagesExtra,
        });
        return;
      }
      const { imagesA, imagesB } = await buildItemCheckImages(
        datasetA,
        scope === 'A' ? null : datasetB,
        names,
        settings,
        onProgress,
        view,
        excludeFail,
      );
      if (scope === 'A') {
        await exportItemCheckReport({
          items: names,
          fileNameA: fileNameA || datasetA?.title || '数据 A',
          imagesA,
          extraHeaders,
          imagesExtra,
        });
        return;
      }
      await exportItemCheckReport({
        items: names,
        fileNameA: fileNameA || datasetA?.title || '数据 A',
        // 没有 B 数据时不要传占位名，后端会整列省略
        fileNameB: datasetB ? fileNameB || datasetB.title || '数据 B' : undefined,
        imagesA,
        imagesB,
        extraHeaders,
        imagesExtra,
      });
    } catch (err) {
      const detail = (err as unknown as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      onError(detail || (err instanceof Error ? err.message : '报告导出失败'));
    } finally {
      setExporting(null);
    }
  };

  return {
    exporting,
    hasBothDatasets,
    handleExportCurrent,
    handleExportCorrelation,
    handleExportImages,
    handleExportReport,
  };
}
