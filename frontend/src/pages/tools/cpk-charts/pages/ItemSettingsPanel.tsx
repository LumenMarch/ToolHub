// 单测试项设置面板 — 对齐 OPP theHistogramSettingsView / theCDFSettingsView / theTimeSeriesSettingsView
// 三类图各自显示独立设置行，底部公共 Legend 设置；控件位置遵循前端布局
import React from 'react';
import { type ChartSettings, type ColumnAnalysis } from '../lib/stats';

const NumInput: React.FC<{ label: string; manual: number | null; auto: number | null; onManual: (v: number | null) => void }> = ({ label, manual, auto, onManual }) => {
  const [draft, setDraft] = React.useState<string>(() => (manual !== null ? String(manual) : auto !== null ? String(auto) : ''));
  const prevAuto = React.useRef<number | null>(auto);
  React.useEffect(() => {
    if (manual === null && auto !== prevAuto.current) setDraft(auto !== null ? String(auto) : '');
    prevAuto.current = auto;
  }, [auto, manual]);
  return (
    <label className="flex items-center gap-1.5 font-mono text-[0.6875rem] text-foreground">
      <span className="min-w-14">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const t = draft.trim();
          if (t === '') onManual(null);
          else {
            const n = Number(t);
            if (Number.isFinite(n)) onManual(n);
            else {
              // 无效输入不保留在控件中：回退为自动值，避免“显示手动值、实际用自动值”的错位
              onManual(null);
              setDraft(auto !== null ? String(auto) : '');
            }
          }
        }}
        placeholder={auto !== null ? String(auto) : '—'}
        className="w-20 border border-border bg-background px-1.5 py-1 text-xs outline-none focus:border-foreground"
      />
    </label>
  );
};

type ViewKey = 'histogram' | 'cdf' | 'timeseries';

interface ItemSettingsPanelProps {
  view: ViewKey;
  settings: ChartSettings;
  onUpdate: <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => void;
  activeCol: ColumnAnalysis | null;
}

const ItemSettingsPanel: React.FC<ItemSettingsPanelProps> = ({ view, settings, onUpdate, activeCol }) => {
  const check = (k: keyof ChartSettings) => (
    <label key={String(k)} className="flex cursor-pointer items-center gap-1.5 font-mono text-[0.6875rem] text-foreground">
      <input type="checkbox" checked={Boolean(settings[k])} onChange={(e) => onUpdate(k, e.target.checked)} className="size-3.5 accent-primary" />
      {String(k)}
    </label>
  );

  return (
    <div className="flex flex-col gap-3 border border-border bg-muted/40 px-4 py-3">
      {view === 'histogram' && (
        <>
          <div className="flex flex-wrap items-center gap-5">
            {(['showTitle', 'showStats', 'showLimits', 'showCounts', 'showOutlines', 'showPercentage'] as Array<keyof ChartSettings>).map((k) => check(k))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <NumInput label="Bin Count" manual={settings.binCount} auto={75} onManual={(v) => onUpdate('binCount', v)} />
            <NumInput label="Upper Range" manual={settings.upperRange} auto={activeCol ? activeCol.dataDomain[1] : null} onManual={(v) => onUpdate('upperRange', v)} />
            <NumInput label="Lower Range" manual={settings.lowerRange} auto={activeCol ? activeCol.dataDomain[0] : null} onManual={(v) => onUpdate('lowerRange', v)} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <NumInput label="Upper Limit" manual={settings.upperLimit} auto={activeCol ? activeCol.column.upper : null} onManual={(v) => onUpdate('upperLimit', v)} />
            <NumInput label="Lower Limit" manual={settings.lowerLimit} auto={activeCol ? activeCol.column.lower : null} onManual={(v) => onUpdate('lowerLimit', v)} />
            {/* 对齐 OPP theYUpperTextBox：手动 Y 轴上限（无自动占位） */}
            <NumInput label="Y-Upper" manual={settings.yUpper} auto={null} onManual={(v) => onUpdate('yUpper', v)} />
          </div>
        </>
      )}
      {view === 'cdf' && (
        <>
          <div className="flex flex-wrap items-center gap-5">
            {(['showTitle', 'showStats', 'showLimits', 'cdfLog', 'cdfShowHundredths', 'cdfFill'] as Array<keyof ChartSettings>).map((k) => check(k))}
            <label className="flex items-center gap-2 font-mono text-[0.6875rem] text-foreground">
              CDF Type
              <select
                value={settings.cdfType}
                onChange={(e) => onUpdate('cdfType', e.target.value as ChartSettings['cdfType'])}
                className="border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground"
              >
                <option value="cdf">CDF</option>
                <option value="ccdf">CCDF</option>
                <option value="folded">Folded</option>
              </select>
            </label>
          </div>
          {/* 对齐 OPP theCDFSettingsView：Range / Limit 手动输入（分析域已由 analyzeColumn 支持） */}
          <div className="flex flex-wrap items-center gap-4">
            <NumInput label="Upper Range" manual={settings.upperRange} auto={activeCol ? activeCol.dataDomain[1] : null} onManual={(v) => onUpdate('upperRange', v)} />
            <NumInput label="Lower Range" manual={settings.lowerRange} auto={activeCol ? activeCol.dataDomain[0] : null} onManual={(v) => onUpdate('lowerRange', v)} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <NumInput label="Upper Limit" manual={settings.upperLimit} auto={activeCol ? activeCol.column.upper : null} onManual={(v) => onUpdate('upperLimit', v)} />
            <NumInput label="Lower Limit" manual={settings.lowerLimit} auto={activeCol ? activeCol.column.lower : null} onManual={(v) => onUpdate('lowerLimit', v)} />
          </div>
        </>
      )}
      {view === 'timeseries' && (
        <>
          <div className="flex flex-wrap items-center gap-5">
            {(['showTitle', 'showStats', 'showLimits', 'tsLines', 'tsFill', 'tsMean'] as Array<keyof ChartSettings>).map((k) => check(k))}
          <label className="flex items-center gap-2 font-mono text-[0.6875rem] text-foreground">
            Line Width
            <select
              value={settings.lineWidth}
              onChange={(e) => onUpdate('lineWidth', e.target.value as ChartSettings['lineWidth'])}
              className="border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground"
            >
              <option value="none">None</option>
              <option value="thin">Thin</option>
              <option value="med">Med</option>
              <option value="thick">Thick</option>
            </select>
          </label>
          <label className="flex items-center gap-2 font-mono text-[0.6875rem] text-foreground">
            Data Ticks
            <select
              value={settings.dataSymbol}
              onChange={(e) => onUpdate('dataSymbol', e.target.value as ChartSettings['dataSymbol'])}
              className="border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground"
            >
              <option value="none">None</option>
              <option value="circle">O</option>
              <option value="plus">+</option>
              <option value="cross">x</option>
            </select>
          </label>
          </div>
          {/* 对齐 OPP theTimeSeriesSettingsView：Range / Limit 手动输入 */}
          <div className="flex flex-wrap items-center gap-4">
            <NumInput label="Upper Range" manual={settings.upperRange} auto={activeCol ? activeCol.dataDomain[1] : null} onManual={(v) => onUpdate('upperRange', v)} />
            <NumInput label="Lower Range" manual={settings.lowerRange} auto={activeCol ? activeCol.dataDomain[0] : null} onManual={(v) => onUpdate('lowerRange', v)} />
            <NumInput label="Upper Limit" manual={settings.upperLimit} auto={activeCol ? activeCol.column.upper : null} onManual={(v) => onUpdate('upperLimit', v)} />
            <NumInput label="Lower Limit" manual={settings.lowerLimit} auto={activeCol ? activeCol.column.lower : null} onManual={(v) => onUpdate('lowerLimit', v)} />
          </div>
        </>
      )}
      {/* 公共：Legend 显示开关 / 位置 / 计数（对齐 OPP 底部 Legend 设置） */}
      <div className="mt-3 flex flex-wrap items-center gap-5 border-t border-border pt-3">
        {check('legendEnabled')}
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
        {check('legendCounts')}
      </div>
    </div>
  );
};

export default ItemSettingsPanel;
