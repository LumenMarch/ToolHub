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
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

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

    const dataTransfer = event.dataTransfer
    const entries: FileSystemEntry[] = []
    for (let index = 0; index < dataTransfer.items.length; index++) {
      const entry = dataTransfer.items[index]?.webkitGetAsEntry?.()
      if (entry) entries.push(entry)
    }
    if (entries.length > 0) {
      const collected = await collectDroppedFiles(entries)
      if (collected.length > 0) {
        deliverFiles(collected)
        return
      }
    }
    deliverFiles(Array.from(dataTransfer.files))
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return
    if (multiple && onSelectMultiple && files.length > 0) {
      onSelectMultiple(Array.from(files))
    } else if (files.length > 0) {
      onSelect(files[0])
    }
    event.target.value = ''
  }

  const hasFile = file !== null

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
          'flex min-h-48 w-full flex-col justify-center gap-3 rounded-xl border border-dashed p-6 text-left transition-colors',
          disabled && 'cursor-not-allowed opacity-50',
          isDragging
            ? 'border-primary bg-primary/5'
            : hasFile
              ? 'border-primary/40 bg-card'
              : 'border-border bg-card hover:bg-muted/40',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{label}</span>
          {hasFile ? null : <Upload className="size-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0">
          <p className={cn('truncate font-medium', fileNameClassName)}>
            {hasFile ? file.name : '拖放或选择文件'}
          </p>
          <p
            id={`${id}-description`}
            className="mt-1 text-sm text-muted-foreground"
          >
            {hasFile ? formatSize(file.size) : description}
          </p>
        </div>
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
