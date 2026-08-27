import React from 'react';

interface LoadingOverlayProps {
  loading: boolean;
  progress: number; // 0..1
  message?: string;
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ loading, progress, message }) => {
  if (!loading) return null;
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
      <div className="flex w-full max-w-sm flex-col gap-3 border border-border bg-background px-6 py-5 shadow-2xl">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-foreground">{message || '正在解析 CSV…'}</p>
        <div className="h-2 w-full overflow-hidden border border-border bg-muted">
          <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${pct * 100}%` }} />
        </div>
        <p className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">{Math.round(pct * 100)}%</p>
      </div>
    </div>
  );
};

export default LoadingOverlay;
