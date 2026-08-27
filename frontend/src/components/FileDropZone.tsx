import React, { useRef, useState } from 'react';
import { FileArrowUp, X } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { collectDroppedFiles } from '../lib/dragFiles';

interface FileDropZoneProps {
  /** 输入框 id，用于 label/labelledby 关联 */
  id: string;
  /** 区域标签 */
  label: string;
  /** 提示文案 */
  description: string;
  /** 接受的文件类型，如 ".xls,.xlsx,.csv" */
  accept?: string;
  /** 当前选中的单个文件 */
  file: File | null;
  /** 文件选择回调 */
  onSelect: (file: File) => void;
  /** 清除已选文件回调 */
  onClear?: () => void;
  /** 禁用状态 */
  disabled?: boolean;
  /** 是否允许选择整个目录（webkitdirectory） */
  directory?: boolean;
  /** 多文件选择 */
  multiple?: boolean;
  /** 多文件选择回调（与 onSelect 互斥） */
  onSelectMultiple?: (files: File[]) => void;
  /** 选中文件后文件名的 className（默认大号标题；可传入缩小样式） */
  fileNameClassName?: string;
}

/** 格式化文件大小为人类可读格式 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 递归读取目录条目:readEntries 每次只返回一部分条目,
 * 必须循环调用直到返回空数组才算读完(Chromium 行为)。
 */
const FileDropZone: React.FC<FileDropZoneProps> = ({
  accept,
  description,
  directory = false,
  disabled = false,
  file,
  id,
  label,
  fileNameClassName,
  multiple = false,
  onClear,
  onSelect,
  onSelectMultiple,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const deliverFiles = (files: File[]) => {
    if (multiple && onSelectMultiple) {
      onSelectMultiple(files);
    } else if (files.length > 0) {
      onSelect(files[0]);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const dataTransfer = event.dataTransfer;
    // 优先走 items 条目:拖入文件夹时 files 为空,必须递归遍历目录条目;
    // 纯文件拖放同样走条目,顺序与 files 一致,行为透明。
    const entries: FileSystemEntry[] = [];
    for (let index = 0; index < dataTransfer.items.length; index++) {
      const entry = dataTransfer.items[index]?.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      const collected = await collectDroppedFiles(entries);
      if (collected.length > 0) {
        deliverFiles(collected);
        return;
      }
    }
    // 兜底:无条目或条目收集为空时退回 files。
    deliverFiles(Array.from(dataTransfer.files));
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    if (multiple && onSelectMultiple && files.length > 0) {
      onSelectMultiple(Array.from(files));
    } else if (files.length > 0) {
      onSelect(files[0]);
    }
    // 重置 input 以便再次选择同一文件
    event.target.value = '';
  };

  const hasFile = file !== null;

  return (
    <div className="relative min-w-0">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        // @ts-expect-error webkitdirectory 和 directory 是非标准属性，用于文件夹选择
        webkitdirectory={directory ? '' : undefined}
        directory={directory ? '' : undefined}
        multiple={multiple}
        aria-label={`选择${label}`}
        className="sr-only"
        disabled={disabled}
        onChange={handleChange}
      />
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        aria-disabled={disabled || undefined}
        aria-describedby={`${id}-description`}
        className={cn(
          'group flex min-h-64 w-full flex-col justify-between border-2 p-6 text-left transition-colors md:p-8',
          disabled && 'cursor-not-allowed opacity-50',
          isDragging
            ? 'border-primary bg-primary/10'
            : hasFile
              ? 'border-primary/40 bg-card'
              : 'border-border bg-card hover:border-primary',
        )}
      >
        <div className="flex w-full items-start justify-between gap-4">
          <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground md:text-sm">
            {label}
          </span>
          {hasFile ? null : (
            <FileArrowUp
              weight="bold"
              className="size-7 shrink-0 text-primary transition-transform group-hover:-translate-y-1"
            />
          )}
        </div>

        <div className="min-w-0">
          <p
            className={cn(
              'break-words tracking-tight',
              typeof fileNameClassName === 'string' && fileNameClassName.length > 0
                ? fileNameClassName
                : 'text-2xl font-bold md:text-3xl',
            )}
          >
            {hasFile ? file.name : '拖放或选择文件'}
          </p>
          <p
            id={`${id}-description`}
            className="mt-3 font-mono text-xs leading-relaxed text-muted-foreground"
          >
            {hasFile ? formatSize(file.size) : description}
          </p>
        </div>
      </div>
      {hasFile && onClear && (
        <button
          type="button"
          onClick={() => onClear()}
          className="absolute right-6 top-6 flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-primary md:right-8 md:top-8"
          aria-label="清除已选文件"
        >
          <X weight="bold" className="size-5" />
        </button>
      )}
    </div>
  );
};

export default FileDropZone;
