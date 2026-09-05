import React from 'react';

export const StatItem: React.FC<{ label: string; value: number; unit?: string }> = ({
  label,
  value,
  unit = 'S',
}) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="text-sm font-semibold tabular-nums">
      {Number.isFinite(value)
        ? `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`
        : '—'}
    </dd>
  </div>
);
