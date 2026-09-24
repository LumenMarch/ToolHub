import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { collectDroppedFiles } from '@/lib/dragFiles'

interface FileDropZoneProps {
  id: string
  label: string
  description: string
  accept?: string
  file: File | null
  onSelect: (file: File) => void
  onClear?: () => void
  disabled?: boolean
  directory?: boolean
  multiple?: boolean
  onSelectMultiple?: (files: File[]) => void
  fileNameClassName?: string
  /** 紧凑模式：单行高度，适用于下方已有文件列表、无需大面积拖放区的场景 */
  compact?: boolean
}

/** 两种排版共用的展示入参 */
interface ZoneContentProps {
  description: string
  file: File | null
  fileNameClassName?: string
  id: string
  label: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** 拖放/已选状态对应的边框与底色 */
function zoneStateClass(isDragging: boolean, hasFile: boolean): string {
  if (isDragging) return 'border-primary bg-primary/5'
  if (hasFile) return 'border-primary/40 bg-card'
  return 'border-border bg-card hover:bg-muted/40'
}

/** 优先按 DataTransfer 条目递归展开（支持目录），无条目时退回 files 列表 */
async function droppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = []
  for (let index = 0; index < dataTransfer.items.length; index++) {
    const entry = dataTransfer.items[index]?.webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }
  if (entries.length > 0) {
    const collected = await collectDroppedFiles(entries)
    if (collected.length > 0) return collected
  }
  return Array.from(dataTransfer.files)
}

/** 紧凑排版：图标 + 标签 + 提示（或文件名）单行 */
const CompactZone: React.FC<ZoneContentProps> = ({
  description,
  file,
  fileNameClassName,
  id,
  label,
}) => {
  const hasFile = file !== null
  return (
    <>
      <Upload className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 text-sm font-medium">{label}</span>
        <span
          id={`${id}-description`}
          className={cn(
            'truncate text-sm',
            hasFile ? cn('font-medium', fileNameClassName) : 'text-muted-foreground',
          )}
        >
          {hasFile ? `${file.name}（${formatSize(file.size)}）` : description}
        </span>
      </div>
    </>
  )
}

/** 默认排版：大块面板，适合单文件主输入 */
const PanelZone: React.FC<ZoneContentProps> = ({
  description,
  file,
  fileNameClassName,
  id,
  label,
}) => {
  const hasFile = file !== null
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {hasFile ? null : <Upload className="size-4 text-muted-foreground" />}
      </div>
      <div className="min-w-0">
        <p className={cn('truncate font-medium', fileNameClassName)}>
          {hasFile ? file.name : '拖放或选择文件'}
        </p>
        <p id={`${id}-description`} className="mt-1 text-sm text-muted-foreground">
          {hasFile ? formatSize(file.size) : description}
        </p>
      </div>
    </>
  )
}

const FileDropZone: React.FC<FileDropZoneProps> = ({
  accept,
  compact = false,
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
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const deliverFiles = (files: File[]) => {
    if (multiple && onSelectMultiple) {
      onSelectMultiple(files)
    } else if (files.length > 0) {
      onSelect(files[0])
    }
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) return
    deliverFiles(await droppedFiles(event.dataTransfer))
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0) deliverFiles(Array.from(files))
    event.target.value = ''
  }

  const hasFile = file !== null
  const contentProps: ZoneContentProps = { description, file, fileNameClassName, id, label }

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
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!disabled) setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => void handleDrop(event)}
        aria-disabled={disabled || undefined}
        aria-describedby={`${id}-description`}
        className={cn(
          'flex w-full rounded-xl border border-dashed text-left transition-[background-color,border-color,transform] duration-150 ease-out-strong motion-safe:active:translate-y-px',
          compact
            ? 'items-center gap-3 p-3'
            : 'min-h-48 flex-col justify-center gap-3 p-6',
          disabled && 'cursor-not-allowed opacity-50',
          zoneStateClass(isDragging, hasFile),
        )}
      >
        {compact ? <CompactZone {...contentProps} /> : <PanelZone {...contentProps} />}
      </div>
      {hasFile && onClear ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3"
          onClick={() => onClear()}
          aria-label="清除已选文件"
        >
          <X />
        </Button>
      ) : null}
    </div>
  )
}

export default FileDropZone
