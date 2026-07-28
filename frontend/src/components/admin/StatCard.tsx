import React from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  hint?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, hint }) => {
  return (
    <div className="border border-border p-6 md:p-8 transition-colors hover:border-primary">
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-4">
        {label}
      </p>
      <p className="text-4xl md:text-5xl font-bold tracking-tighter leading-none">
        {value}
      </p>
      {hint && (
        <p className="mt-3 text-[11px] font-mono uppercase tracking-widest text-muted-foreground opacity-60">
          {hint}
        </p>
      )}
    </div>
  );
};

export default StatCard;
