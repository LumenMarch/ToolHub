import React, { useMemo, useRef, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  TtStationBoxPlotChart,
  TtStationQ3LineChart,
  type StationBoxPlotHandle,
  type StationQ3LineChartHandle,
} from './charts';
import type { ComparisonReferenceLine, StationBoxGroup } from './lib';
import { StationComparisonTable } from './StationComparisonTable';
import type { ActiveModule } from './types';

type Props = {
  activeModule: ActiveModule;
  fileName: string;
  allStationBoxGroups: StationBoxGroup[];
};

export const TtTimeExtraModules: React.FC<Props> = ({
  activeModule,
  fileName,
  allStationBoxGroups,
}) => {
  // 模块 2：箱线图相关状态
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | 'all'>('all');
  const [lockdownTTStr, setLockdownTTStr] = useState('');
  const [exportingGroup, setExportingGroup] = useState<number | null>(null);

  // 模块 3：机台数据对比相关状态
  const [customComparisonTitle, setCustomComparisonTitle] = useState('');
  const [referenceLines, setReferenceLines] = useState<ComparisonReferenceLine[]>([]);
  const [newLineValue, setNewLineValue] = useState('');
  const [newLineLabel, setNewLineLabel] = useState('');
  const [isExportingComparisonChart, setIsExportingComparisonChart] = useState(false);

  const boxPlotRefs = useRef<Record<number, StationBoxPlotHandle | null>>({});
  const q3LineChartRef = useRef<StationQ3LineChartHandle | null>(null);

  // 将机台分成每组最多 10 个（与 main 分组导出一致；展示全部机台）
  const stationBoxChunks = useMemo(() => {
    const chunks: StationBoxGroup[][] = [];
    for (let i = 0; i < allStationBoxGroups.length; i += 10) {
      chunks.push(allStationBoxGroups.slice(i, i + 10));
    }
    return chunks;
  }, [allStationBoxGroups]);

  const lockdownTT = useMemo(() => {
    const val = Number(lockdownTTStr.trim());
    return Number.isFinite(val) && val > 0 ? val : null;
  }, [lockdownTTStr]);

  const comparisonTitle =
    customComparisonTitle.trim() ||
    `${fileName.replace(/\.[^/.]+$/, '') || fileName} 各机台数据对比`;

  const handleAddReferenceLine = () => {
    const val = Number(newLineValue.trim());
    if (!Number.isFinite(val) || val <= 0) return;
    const line: ComparisonReferenceLine = {
      id: `ref-${Date.now()}`,
      value: val,
      label: newLineLabel.trim() || `${val}S 阈值`,
      color: '#ef4444',
    };
    setReferenceLines((prev) => [...prev, line]);
    setNewLineValue('');
    setNewLineLabel('');
  };

  const handleRemoveReferenceLine = (id: string) => {
    setReferenceLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleExportComparisonChartPng = async () => {
    if (!q3LineChartRef.current) return;
    try {
      setIsExportingComparisonChart(true);
      const title =
        customComparisonTitle.trim() ||
        `${fileName.replace(/\.[^/.]+$/, '') || '测试日志'}_各机台数据对比`;
      await q3LineChartRef.current.exportPng(title);
    } finally {
      setIsExportingComparisonChart(false);
    }
  };

  if (activeModule === 'boxplot') {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">显示分组：</span>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={selectedGroupIdx === 'all' ? 'default' : 'outline'}
                onClick={() => setSelectedGroupIdx('all')}
              >
                全部分组 ({stationBoxChunks.length})
              </Button>
              {stationBoxChunks.map((chunk, groupIndex) => {
                const groupKey = `group-${chunk[0]?.stationId ?? ''}-${chunk.length}`;
                return (
                  <Button
                    key={groupKey}
                    type="button"
                    size="sm"
                    variant={selectedGroupIdx === groupIndex ? 'default' : 'outline'}
                    onClick={() => setSelectedGroupIdx(groupIndex)}
                  >
                    第 {groupIndex + 1} 组
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="box-lockdown-tt"
              className="text-sm font-medium text-muted-foreground whitespace-nowrap"
            >
              Lockdown TT:
            </label>
            <Input
              id="box-lockdown-tt"
              type="number"
              step="any"
              placeholder="输入红线标注值 (S)"
              className="h-8 w-44"
              value={lockdownTTStr}
              onChange={(e) => setLockdownTTStr(e.target.value)}
            />
          </div>
        </div>

        {stationBoxChunks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              未检索到机台数据
            </CardContent>
          </Card>
        ) : (
          stationBoxChunks.map((chunk, index) => {
            if (selectedGroupIdx !== 'all' && selectedGroupIdx !== index) {
              return null;
            }
            const fromNum = index * 10 + 1;
            const toNum = index * 10 + chunk.length;
            const isExporting = exportingGroup === index;

            const handleExport = async () => {
              const handle = boxPlotRefs.current[index];
              if (!handle) return;
              try {
                setExportingGroup(index);
                const cleanName = (fileName || 'tt-time').replace(/\.[^/.]+$/, '');
                await handle.exportPng(`${cleanName}_箱线图_第${index + 1}组`);
              } finally {
                setExportingGroup(null);
              }
            };

            return (
              <Card key={`station-box-chunk-${fromNum}-${toNum}`}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle>
                        机台测试时间箱线图（第 {index + 1} 组：Station {fromNum} ~ {toNum}）
                      </CardTitle>
                      <CardDescription>
                        X 轴为 Station ID，Y 轴为测试时间(S)。绿色实线为平均值，红色实线为
                        Lockdown TT。
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isExporting}
                      onClick={() => void handleExport()}
                    >
                      <Download data-icon="inline-start" />
                      {isExporting ? '导出中…' : '导出图片'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <TtStationBoxPlotChart
                    ref={(el) => {
                      boxPlotRefs.current[index] = el;
                    }}
                    groups={chunk}
                    lockdownTT={lockdownTT}
                    className="w-full"
                  />
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    );
  }

  if (activeModule === 'comparison') {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>图表设置与参考线标注</CardTitle>
            <CardDescription>
              自定义图表标题，在 Q3 折线图上添加水平参考线与文本说明。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Field className="flex-1">
                <FieldLabel htmlFor="comp-title">图表主标题</FieldLabel>
                <Input
                  id="comp-title"
                  value={customComparisonTitle}
                  placeholder="输入图表主标题"
                  onChange={(e) => setCustomComparisonTitle(e.target.value)}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isExportingComparisonChart || allStationBoxGroups.length === 0}
                  onClick={() => void handleExportComparisonChartPng()}
                  className="gap-2"
                >
                  <Download className="size-4" />
                  {isExportingComparisonChart ? '正在导出...' : '导出折线图 PNG'}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="text-xs font-semibold text-foreground">
                参考线标注（折线图水平标记线）
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  step="any"
                  placeholder="耗时(S)，如 190"
                  className="w-32"
                  value={newLineValue}
                  onChange={(e) => setNewLineValue(e.target.value)}
                />
                <Input
                  placeholder="文本说明（可选，如 基准线 / 目标值）"
                  className="w-64 flex-1"
                  value={newLineLabel}
                  onChange={(e) => setNewLineLabel(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleAddReferenceLine}
                  className="gap-1"
                >
                  <Plus className="size-3.5" />
                  添加参考线
                </Button>
              </div>

              {referenceLines.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {referenceLines.map((line) => (
                    <div
                      key={line.id}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs shadow-2xs"
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: line.color || '#ef4444' }}
                      />
                      <span className="font-bold text-foreground tabular-nums">
                        {line.value}S
                      </span>
                      <span className="text-muted-foreground">{line.label}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveReferenceLine(line.id)}
                        className="ml-1 text-muted-foreground transition-colors hover:text-destructive"
                        title="删除参考线"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>各机台五数统计数据</CardTitle>
            <CardDescription>
              包含各机台的最大值、Q3 (上四分位)、Med (中位数)、Q1 (下四分位) 与最小值。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StationComparisonTable groups={allStationBoxGroups} title={comparisonTitle} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>各机台 Q3 耗时对比折线图</CardTitle>
            <CardDescription>
              展示各机台的 Q3 (上四分位数) 测试时间，红线为设备分类参考线。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TtStationQ3LineChart
              ref={q3LineChartRef}
              groups={allStationBoxGroups}
              referenceLines={referenceLines}
              title={customComparisonTitle.trim() || undefined}
              className="w-full"
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
};
