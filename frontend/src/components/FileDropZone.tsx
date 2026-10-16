import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { toast } from 'sonner'

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
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
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
      </span>
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
      <span className="block min-w-0">
        <span className={cn('block truncate font-medium', fileNameClassName)}>
          {hasFile ? file.name : '拖放或选择文件'}
        </span>
        <span
          id={`${id}-description`}
          className="mt-1 block text-sm text-muted-foreground"
        >
          {hasFile ? formatSize(file.size) : description}
        </span>
      </span>
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

  const handleDrop = async (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) {
      // 禁用期拖放也要有反馈：原生 disabled 的控件不派发 drop，事件根本到不了这里，
      // 所以按钮只用 aria-disabled + tabIndex 表达禁用，才能接住这次拖放
      toast.info('当前正在处理上一个文件，暂不能更换')
      return
    }
    try {
      deliverFiles(await droppedFiles(event.dataTransfer))
    } catch {
      // 受保护目录、权限被拒等会让目录展开抛错，静默失败会让用户以为拖放没生效
      toast.error('读取拖入的文件失败')
    }
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
      <button
        type="button"
        // 不用原生 disabled：它会让 drop 事件静默丢失，用户拖入文件毫无反馈
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={() => {
          if (disabled) return
          inputRef.current?.click()
        }}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!disabled) setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => void handleDrop(event)}
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
      </button>
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
