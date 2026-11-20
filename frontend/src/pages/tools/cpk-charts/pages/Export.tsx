// 导出页：勾选测试项导出当前图 / 相关性图 / 图片 ZIP / .numbers 报告。
// 动作细节在 lib/useExportActions.ts，勾选列表在 components/ExportItemPicker.tsx。
import React, { useMemo, useState } from 'react';
import { BarChart3, Download, Images } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import useOppStore, { getMerged } from '../store/useOppStore';
import { shortName } from '../lib/stats';
import { useCurrentAnalysis } from '../lib/useCurrentAnalysis';
import { useExportActions } from '../lib/useExportActions';
import ExportItemPicker from '../components/ExportItemPicker';

const Export: React.FC = () => {
  const datasetA = useOppStore((s) => s.datasetA);
  const datasetB = useOppStore((s) => s.datasetB);
  const selectedName = useOppStore((s) => s.selectedName);
  const corrYName = useOppStore((s) => s.corrYName);
  const chartType = useOppStore((s) => s.chartType);
  const settings = useOppStore((s) => s.settings);
  const fileNameA = useOppStore((s) => s.fileNameA);
  const fileNameB = useOppStore((s) => s.fileNameB);
  const compareMode = useOppStore((s) => s.compareMode);
  const excludeFail = useOppStore((s) => s.excludeFail);
  const setError = useOppStore((s) => s.setError);
  const merged = useOppStore(useShallow((s) => getMerged(s)));
  const accumulatedLimits = useOppStore((s) => s.accumulatedLimits);

  const [exportQuery, setExportQuery] = useState('');
  // null = 用户尚未手动调整勾选：此时默认全选当前 merged，避免 dataset 在刷新后
  // 才从总览页载入时勾选集合仍停留在首挂载的空快照（导致所有导出按钮被禁用）
  const [exportChecked, setExportChecked] = useState<Set<string> | null>(null);
  const defaultChecked = useMemo(() => new Set(merged.map((m) => m.name)), [merged]);
  // 手动勾选要按当前数据集求交集：替换数据集后残留的旧名字会让"已勾选 N 项"
  // 和导出按钮看起来可用，实际却匹配不到任何列、导出 0 项
  const checkedNames = useMemo(
    () =>
      exportChecked
        ? new Set([...exportChecked].filter((name) => defaultChecked.has(name)))
        : defaultChecked,
    [defaultChecked, exportChecked],
  );
  const filteredExport = useMemo(() => {
    const q = exportQuery.trim().toLowerCase();
    return merged.filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [merged, exportQuery]);

  const current = useCurrentAnalysis({
    datasetA,
    datasetB,
    selectedName,
    corrYName,
    settings,
    compareMode,
    excludeFail,
    chartType,
    onError: setError,
  });
  const activeA = current.a;
  const activeB = current.b;

  const {
    exporting,
    hasBothDatasets,
    handleExportCurrent,
    handleExportCorrelation,
    handleExportImages,
    handleExportReport,
  } = useExportActions({
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
    onError: setError,
  });

  if (!datasetA && !datasetB) {
    return (
      <Empty className="h-64 border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BarChart3 />
          </EmptyMedia>
          <EmptyTitle>请先在总览上传数据</EmptyTitle>
          <EmptyDescription>返回总览后选择 CSV 再导出。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const actionsDisabled = exporting !== null || checkedNames.size === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportCurrent}
          disabled={exporting !== null || (!activeA && !activeB)}
        >
          <Download data-icon="inline-start" />
          导出当前{selectedName ? ` · ${shortName(selectedName)}` : ''}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportCorrelation}
          disabled={exporting !== null || !selectedName || !corrYName}
        >
          <Download data-icon="inline-start" />
          导出相关性图
          {selectedName && corrYName
            ? ` · ${shortName(selectedName)} vs ${shortName(corrYName)}`
            : ''}
        </Button>
        {exporting?.kind === 'single' ? (
          <span className="text-xs text-muted-foreground">导出中…</span>
        ) : null}
      </div>

      <ExportItemPicker
        merged={merged}
        filtered={filteredExport}
        checkedNames={checkedNames}
        query={exportQuery}
        compareMode={compareMode}
        datasetA={datasetA}
        datasetB={datasetB}
        onQueryChange={setExportQuery}
        onCheckedChange={setExportChecked}
        footer={
          <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs tabular-nums text-muted-foreground">
              {exporting && (exporting.kind === 'all' || exporting.kind === 'itemCheck') ? (
                <span>
                  导出中 {exporting.done}/{exporting.total}{' '}
                  {exporting.kind === 'itemCheck' ? '(报告)' : '(ZIP)'}
                </span>
              ) : null}
              {!exporting ? (
                <span className="hidden sm:inline">勾选 {checkedNames.size} 项 · 表头取文件名</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {hasBothDatasets ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleExportImages('A')}
                    disabled={actionsDisabled}
                  >
                    {exporting?.kind === 'all' ? '打包中…' : '导出 A_图片'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleExportImages('B')}
                    disabled={actionsDisabled}
                  >
                    {exporting?.kind === 'all' ? '打包中…' : '导出 B_图片'}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleExportImages('all')}
                  disabled={actionsDisabled}
                >
                  {exporting?.kind === 'all' ? 'ZIP 打包中…' : `导出图片 (${checkedNames.size})`}
                </Button>
              )}
              <Button
                type="button"
                onClick={() =>
                  void handleExportReport(
                    hasBothDatasets ? (compareMode ? 'merged' : 'A') : datasetA ? 'A' : 'B',
                  )
                }
                disabled={actionsDisabled}
                title={
                  hasBothDatasets && compareMode
                    ? '按对比模式生成 .numbers：A列Item，B/C列为数据A/数据B图表'
                    : '按单文件生成 .numbers：A列Item，B列为图表，累加模式追加列'
                }
              >
                <Images data-icon="inline-start" />
                {exporting?.kind === 'itemCheck'
                  ? '报告生成中…'
                  : hasBothDatasets
                    ? compareMode
                      ? '导出对比报告'
                      : '导出单文件报告'
                    : '导出报告 (.numbers)'}
              </Button>
            </div>
          </div>
        }
      />
    </div>
  );
};

export default Export;
