import React, { useEffect, useId, useRef } from 'react';
import { X } from '@phosphor-icons/react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, footer }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // 同步原生 dialog 状态并锁定背景滚动。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    if (open && !dialog.open) {
      dialog.showModal();
      document.body.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      dialog.close();
    }

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-4 text-foreground"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="relative flex min-h-full items-center justify-center">
        <button
          type="button"
          aria-label="关闭"
          className="fixed inset-0 bg-background/80 backdrop-blur-sm cursor-default"
          onClick={onClose}
        />

        <div className="relative z-10 w-full max-w-md bg-background border border-border shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 id={titleId} className="text-lg font-bold tracking-tight">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-6 space-y-4">{children}</div>

          {footer && (
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              {footer}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
};

export default Modal;
