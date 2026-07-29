import React, { useRef, useState } from 'react';
import { FileArrowUp, X } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

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
}

/** 格式化文件大小为人类可读格式 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const FileDropZone: React.FC<FileDropZoneProps> = ({
  accept,
  description,
  directory = false,
  disabled = false,
  file,
  id,
  label,
  multiple = false,
  onClear,
  onSelect,
  onSelectMultiple,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const files = event.dataTransfer.files;
    if (multiple && onSelectMultiple) {
      onSelectMultiple(Array.from(files));
    } else if (files.length > 0) {
      onSelect(files[0]);
    }
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
          <FileArrowUp
            weight="bold"
            className="size-7 shrink-0 text-primary transition-transform group-hover:-translate-y-1"
          />
        </div>

        <div className="min-w-0">
          <p className="break-words text-2xl font-bold tracking-tight md:text-3xl">
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
