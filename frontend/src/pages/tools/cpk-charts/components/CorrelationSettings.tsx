// Correlation 设置行（右上）— 对齐 OPP theCorrelationSettingsView：Show Title/Stats/Limits + 测试项 X/Y + Square/Regression/Highlight/σ + Legend
import React from 'react';
import useOppStore, { getMerged } from '../store/useOppStore';
import { useShallow } from 'zustand/react/shallow';
import { shortName, type ChartSettings } from '../lib/stats';
import { useMemo } from 'react';

interface CorrelationSettingsProps {
  settings: ChartSettings;
  onUpdate: <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => void;
  selectedName: string;
  onSelectedName: (v: string) => void;
  corrYName: string;
  onCorrYName: (v: string) => void;
}

const CorrelationSettings: React.FC<CorrelationSettingsProps> = ({ settings, onUpdate, selectedName, onSelectedName, corrYName, onCorrYName }) => {
  const merged = useOppStore(useShallow((s) => getMerged(s)));
  const xOptions = useMemo(() => merged.filter((m) => m.hasA || m.hasB), [merged]);
  const yOptions = useMemo(() => merged.filter((m) => m.name !== selectedName && (m.hasA || m.hasB)), [merged, selectedName]);

  return (
    <div className="flex flex-wrap items-center gap-3 border border-border bg-muted/40 px-4 py-3">
      {(['showTitle', 'showStats', 'showLimits'] as Array<keyof ChartSettings>).map((k) => (
        <label key={String(k)} className="flex cursor-pointer items-center gap-1.5 font-mono text-[0.6875rem] text-foreground">
          <input type="checkbox" checked={Boolean(settings[k])} onChange={(e) => onUpdate(k, e.target.checked)} className="size-3.5 accent-primary" />
          {String(k)}
        </label>
      ))}
      <label className="flex items-center gap-2 font-mono text-[0.6875rem] text-foreground">
        X 轴
        <select value={selectedName} onChange={(e) => onSelectedName(e.target.value)} className="border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground">
          <option value="">选择测试项…</option>
          {xOptions.map((m) => (
            <option key={m.name} value={m.name}>
              {shortName(m.name)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 font-mono text-[0.6875rem] text-foreground">
        Y 轴
        <select value={corrYName} onChange={(e) => onCorrYName(e.target.value)} className="border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground">
          <option value="">选择测试项…</option>
          {yOptions.map((m) => (
            <option key={m.name} value={m.name}>
              {shortName(m.name)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[0.6875rem] text-foreground">
        <input type="checkbox" checked={Boolean(settings.corrSquare)} onChange={(e) => onUpdate('corrSquare', e.target.checked)} className="size-3.5 accent-primary" />
        Square
      </label>
      <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[0.6875rem] text-foreground">
        <input type="checkbox" checked={Boolean(settings.corrRegression)} onChange={(e) => onUpdate('corrRegression', e.target.checked)} className="size-3.5 accent-primary" />
        Regression
      </label>
      <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[0.6875rem] text-foreground">
        <input type="checkbox" checked={Boolean(settings.corrHighlightOutliers)} onChange={(e) => onUpdate('corrHighlightOutliers', e.target.checked)} className="size-3.5 accent-primary" />
        Highlight Outliers
      </label>
      <label className="flex items-center gap-2 font-mono text-[0.6875rem] text-foreground">
        σ
        <select value={settings.corrOutlierSigma ?? 3} onChange={(e) => onUpdate('corrOutlierSigma', Number(e.target.value))} className="border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground">
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
          <option value={5}>5</option>
        </select>
      </label>
      <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[0.6875rem] text-foreground">
        <input type="checkbox" checked={Boolean(settings.legendEnabled)} onChange={(e) => onUpdate('legendEnabled', e.target.checked)} className="size-3.5 accent-primary" />
        Legend
      </label>
      <label className="flex items-center gap-2 font-mono text-[0.6875rem] text-foreground">
        Position
        <select
          value={settings.legendPosition}
          onChange={(e) => onUpdate('legendPosition', e.target.value as ChartSettings['legendPosition'])}
          className="border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground"
        >
          <option value="none">None</option>
          <option value="topright">Top Right</option>
          <option value="bottomright">Bottom Right</option>
          <option value="topleft">Top Left</option>
          <option value="bottomleft">Bottom Left</option>
        </select>
      </label>
    </div>
  );
};

export default CorrelationSettings;
