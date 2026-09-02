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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl border bg-card px-6 py-5 shadow-lg">
        <p className="text-sm font-medium">{message || '正在解析 CSV…'}</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${pct * 100}%` }} />
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">{Math.round(pct * 100)}%</p>
      </div>
    </div>
  );
};

export default LoadingOverlay;
