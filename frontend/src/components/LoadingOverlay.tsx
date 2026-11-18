import React, { useLayoutEffect, useRef } from 'react';

interface LoadingOverlayProps {
  /** 是否显示。false 时不渲染任何节点。 */
  loading: boolean;
  /** 进度 0..1；null 表示暂无确定进度，只显示不定态条。 */
  progress: number | null;
  message: string;
  /** 次要说明，例如当前阶段在做什么。 */
  detail?: string;
}

/** 全屏加载浮层：阻塞式遮罩 + 进度条，用于解析/上传/计算这类不可中断的等待。 */
const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  loading,
  progress,
  message,
  detail,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // 原生 dialog + showModal()：焦点被困在浮层内、遮罩由 top layer 承担，
  // 比自绘 fixed 遮罩更接近真实模态语义。Esc 关闭必须拦掉，否则等待中的界面会被关成半截。
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (loading && !dialog.open) dialog.showModal();
    else if (!loading && dialog.open) dialog.close();
  }, [loading]);

  if (!loading) return null;
  const determinate = progress !== null && Number.isFinite(progress);
  const pct = determinate ? Math.max(0, Math.min(1, progress)) : 0;
  const percent = Math.round(pct * 100);
  return (
    <dialog
      ref={dialogRef}
      aria-label={message}
      onCancel={(event) => event.preventDefault()}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-card p-0 text-foreground shadow-lg outline-none backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-3 px-6 py-5">
        <p className="text-sm font-medium">{message}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={determinate ? percent : undefined}
          aria-valuetext={determinate ? `${percent}%` : '进行中'}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          {determinate ? (
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${pct * 100}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          )}
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">
          {determinate ? `${percent}%` : '进行中…'}
        </p>
      </div>
    </dialog>
  );
};

export default LoadingOverlay;
