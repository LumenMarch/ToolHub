import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderOpen,
  ImageIcon,
  Images,
  Trash2,
  X,
} from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import type { PDFImage } from 'pdf-lib'

import FileDropZone from '@/components/FileDropZone'
import { LoadingSignal } from '@/components/LoadingSignal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'

/*
 * 图片转 PDF — 纯前端实现:
 * - jpg / jpeg 直通 embedJpg(零解码零重编码,画质无损)
 * - png 直通 embedPng(palette 索引色 PNG 会抛错 → 回退 canvas 转 PNG)
 * - webp 等其余格式:createImageBitmap 解码 → canvas → 导出 PNG 再嵌入
 * - 每张图片一个页面,A4 按图片宽高比自动选竖版/横版,图片 contain 居中
 * - 图片仅在本机浏览器内处理,不上传服务器
 */

interface ImageItem {
  file: File
  /** 缩略图 data URL(生成失败时为 null,以图标占位) */
  thumb: string | null
}

interface ReadyState {
  url: string
  name: string
  pageCount: number
  size: number
  failures: string[]
}

type Phase = 'upload' | 'processing' | 'ready'

/** canvas 单边尺寸上限(Chrome/Safari 通用安全值) */
const MAX_CANVAS_DIMENSION = 16384
/** 图片数量上限,避免内存失控 */
const MAX_IMAGES = 20
const A4_PORTRAIT: [number, number] = [595.28, 841.89]
const A4_LANDSCAPE: [number, number] = [841.89, 595.28]
const PAGE_MARGIN = 32

const MERGE_RULES = [
  '每张图片一个页面,按列表顺序合并',
  '可拖入图片或文件夹(含子目录),文件夹按路径排序后合并',
  '页面自动选择 A4 竖版 / 横版,图片等比居中适配',
  'jpg / png 无损直通嵌入,其余格式经 canvas 转 PNG',
  '同名同大小文件视为重复,自动去重',
  `单张图片边长上限 ${MAX_CANVAS_DIMENSION}px,超出将提示失败`,
]

const isImageFile = (file: File): boolean =>
  file.type.startsWith('image/') ||
  /\.(jpe?g|png|webp|bmp|gif|avif)$/i.test(file.name)

const itemKey = (file: File): string => `${file.name}:${file.size}`

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const formatTimestamp = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/** 生成 160px 宽的 JPEG 缩略图 data URL;任何失败(超大图/解码失败)返回 null。 */
const generateThumb = async (file: File): Promise<string | null> => {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 160 })
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0)
      return canvas.toDataURL('image/jpeg', 0.85)
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

/**
 * canvas 路线:解码 → 铺白底 → 导出 PNG → 嵌入。
 * 超出 canvas 边长上限时抛出带文件名上下文的明确错误。
 */
const embedViaCanvas = async (
  doc: PDFDocument,
  file: File,
): Promise<PDFImage> => {
  const bitmap = await createImageBitmap(file)
  try {
    const maxSide = Math.max(bitmap.width, bitmap.height)
    if (
      bitmap.width > MAX_CANVAS_DIMENSION ||
      bitmap.height > MAX_CANVAS_DIMENSION
    ) {
      throw new Error(
        `图片边长 ${maxSide}px 超过 canvas 上限 ${MAX_CANVAS_DIMENSION}px,无法转换`,
      )
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建绘图上下文')
    // 透明图片导出 PNG 保留 alpha,pdf-lib 会生成 SMask;铺白底防 JPEG 类黑底问题。
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    if (!blob) throw new Error('canvas 编码 PNG 失败')
    return await doc.embedPng(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

/** 嵌入一张图片并追加一个 A4 页面(横/竖按图片宽高比自动选择),返回是否成功。 */
const appendImagePage = async (
  doc: PDFDocument,
  file: File,
): Promise<boolean> => {
  const type = file.type.toLowerCase()
  let image: PDFImage
  if (type === 'image/jpeg' || type === 'image/jpg') {
    image = await doc.embedJpg(await file.arrayBuffer())
  } else if (type === 'image/png') {
    try {
      image = await doc.embedPng(await file.arrayBuffer())
    } catch {
      // palette 索引色 PNG 等 pdf-lib 不支持的子类型 → canvas 兜底
      image = await embedViaCanvas(doc, file)
    }
  } else {
    image = await embedViaCanvas(doc, file)
  }

  const { width, height } = image
  const portrait = height >= width
  const [pageW, pageH] = portrait ? A4_PORTRAIT : A4_LANDSCAPE
  const scale = Math.min(
    (pageW - 2 * PAGE_MARGIN) / width,
    (pageH - 2 * PAGE_MARGIN) / height,
  )
  const drawW = width * scale
  const drawH = height * scale
  const page = doc.addPage([pageW, pageH])
  page.drawImage(image, {
    x: (pageW - drawW) / 2,
    y: (pageH - drawH) / 2,
    width: drawW,
    height: drawH,
  })
  return true
}

const Metric: React.FC<{ label: string; value: string | number }> = ({
  label,
  value,
}) => (
  <div className="flex flex-col gap-1">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold tabular-nums">{value}</p>
  </div>
)

const ImageToPdf: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('upload')
  const [items, setItems] = useState<ImageItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<{
    done: number
    total: number
    name: string
  } | null>(null)
  const [ready, setReady] = useState<ReadyState | null>(null)
  const urlRef = useRef<string | null>(null)
  // 事件处理器同步读取的镜像:避免闭包捕获过期 items 导致追加丢失/覆盖。
  const itemsRef = useRef<ImageItem[]>([])
  const directoryInputRef = useRef<HTMLInputElement>(null)

  // 组件卸载时释放下载 object URL。
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  /** 统一的状态更新入口:updater 是纯函数(只读 ref 计算 next),ref 写入发生在函数体而非 updater 回调内。 */
  const updateItems = (updater: (prev: ImageItem[]) => ImageItem[]) => {
    const next = updater(itemsRef.current)
    itemsRef.current = next
    setItems(next)
  }

  const handleSelectMultiple = (files: File[]) => {
    const images = files.filter(isImageFile)
    const rejected = files.length - images.length
    const prev = itemsRef.current
    const existing = new Set(prev.map((item) => itemKey(item.file)))
    const fresh = images.filter((file) => !existing.has(itemKey(file)))
    const duplicateCount = images.length - fresh.length
    const room = Math.max(0, MAX_IMAGES - prev.length)
    const added = fresh.slice(0, room)
    const overflow = fresh.length - added.length
    const ignored = rejected + duplicateCount + overflow

    if (added.length === 0) {
      if (ignored > 0) {
        setNotice(
          `已忽略 ${ignored} 个文件(重复、非图片或超出 ${MAX_IMAGES} 张上限)`,
        )
      }
      return
    }

    setError(null)
    setNotice(
      ignored > 0
        ? `已忽略 ${ignored} 个文件(重复、非图片或超出 ${MAX_IMAGES} 张上限)`
        : null,
    )
    updateItems((p) => [...p, ...added.map((file) => ({ file, thumb: null }))])
    for (const file of added) {
      void generateThumb(file).then((thumb) => {
        updateItems((p) => {
          const index = p.findIndex((item) => item.file === file)
          if (index === -1) return p
          const next = [...p]
          next[index] = { ...next[index], thumb }
          return next
        })
      })
    }
  }

  const handleDirectoryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : []
    event.target.value = ''
    if (files.length === 0) return
    // 文件夹选择:webkitRelativePath 已含子目录路径,按路径排序保证确定性顺序。
    const sorted = [...files].sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(
        b.webkitRelativePath || b.name,
        undefined,
        { numeric: true, sensitivity: 'base' },
      ),
    )
    handleSelectMultiple(sorted)
  }

  const moveItem = (index: number, delta: -1 | 1) => {
    updateItems((p) => {
      const target = index + delta
      if (target < 0 || target >= p.length) return p
      const next = [...p]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const removeItem = (index: number) => {
    updateItems((p) => p.filter((_, i) => i !== index))
  }

  const handleReset = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setReady(null)
    updateItems(() => [])
    setError(null)
    setNotice(null)
    setPhase('upload')
  }

  const handleConvert = async () => {
    if (items.length === 0 || phase === 'processing') return
    setPhase('processing')
    setError(null)
    setReady(null)

    const doc = await PDFDocument.create()
    const failures: string[] = []
    let pageCount = 0
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        setProgress({ done: i, total: items.length, name: item.file.name })
        try {
          if (await appendImagePage(doc, item.file)) pageCount += 1
        } catch (err) {
          failures.push(
            `${item.file.name}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }

      if (pageCount === 0) {
        setError('所有图片均处理失败,未生成 PDF')
        setPhase('upload')
        return
      }

      const pdfBytes = await doc.save()
      const blob = new Blob([pdfBytes.slice()], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = url
      setReady({
        url,
        name: `图片转PDF-${formatTimestamp()}.pdf`,
        pageCount,
        size: blob.size,
        failures,
      })
      setPhase('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成 PDF 失败')
      setPhase('upload')
    } finally {
      setProgress(null)
    }
  }

  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0)
  const jpegCount = items.filter((item) =>
    /^image\/jpe?g$/i.test(item.file.type),
  ).length

  return (
    <div className="flex flex-col gap-6">
      {phase === 'upload' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>选择图片</CardTitle>
              <CardDescription>
                {items.length > 0
                  ? `${items.length} 个文件 · ${formatBytes(totalBytes)}`
                  : `最多 ${MAX_IMAGES} 张，支持 jpg / png / webp。`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FileDropZone
                id="image-files"
                label="图片文件"
                description="支持 jpg / png / webp 等常见图片格式；可拖入图片或文件夹(含子目录)。"
                accept="image/*"
                multiple
                file={items[0]?.file ?? null}
                onSelect={(file) => handleSelectMultiple([file])}
                onSelectMultiple={handleSelectMultiple}
                onClear={handleReset}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <input
                  ref={directoryInputRef}
                  type="file"
                  className="sr-only"
                  multiple
                  // @ts-expect-error webkitdirectory 是非标准属性,用于文件夹选择
                  webkitdirectory=""
                  onChange={handleDirectoryChange}
                  aria-label="选择图片文件夹"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => directoryInputRef.current?.click()}
                >
                  <FolderOpen data-icon="inline-start" />
                  选择文件夹
                </Button>
                <span className="text-xs text-muted-foreground">
                  自动递归收集子目录图片
                </span>
              </div>

              {items.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                    <Metric label="图片数" value={items.length} />
                    <Metric label="总大小" value={formatBytes(totalBytes)} />
                    <Metric label="JPEG 直通" value={jpegCount} />
                    <Metric label="预估页数" value={items.length} />
                  </div>
                  <ul className="flex flex-col gap-2">
                    {items.map((item, index) => (
                      <li
                        key={itemKey(item.file)}
                        className="flex items-center gap-3 rounded-lg border p-2"
                      >
                        {item.thumb ? (
                          <img
                            src={item.thumb}
                            alt=""
                            className="size-14 shrink-0 rounded-md bg-muted object-cover"
                          />
                        ) : (
                          <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted">
                            <ImageIcon className="size-4 text-muted-foreground" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {index + 1}. {item.file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(item.file.size)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => moveItem(index, -1)}
                            disabled={index === 0}
                            aria-label={`上移 ${item.file.name}`}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => moveItem(index, 1)}
                            disabled={index === items.length - 1}
                            aria-label={`下移 ${item.file.name}`}
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeItem(index)}
                            aria-label={`移除 ${item.file.name}`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>尚未选择图片</EmptyTitle>
                    <EmptyDescription>
                      请先选择至少一张图片。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}

              <div className="flex flex-col gap-3">
                <Button
                  type="button"
                  onClick={() => void handleConvert()}
                  disabled={items.length === 0}
                >
                  <ImageIcon data-icon="inline-start" />
                  合并为 PDF
                </Button>
                {notice ? (
                  <Alert>
                    <AlertDescription>{notice}</AlertDescription>
                  </Alert>
                ) : null}
                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>合并规则</CardTitle>
              <CardDescription>
                图片仅在本机浏览器内处理，不会上传服务器。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                {MERGE_RULES.map((rule) => (
                  <li key={rule} className="rounded-lg border bg-muted/30 px-3 py-2">
                    {rule}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {phase === 'processing' ? (
        <Card>
          <CardHeader>
            <CardTitle>正在合并 PDF</CardTitle>
            <CardDescription>
              {progress
                ? `${progress.done + 1} / ${progress.total}`
                : '准备中'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-72 items-center">
            <LoadingSignal
              ariaLabel="生成 PDF 中"
              meta="ImageToPDF / Embed"
              label="图片转 PDF · 生成中"
              detail={progress ? `正在嵌入 ${progress.name}` : '等待处理'}
            />
          </CardContent>
        </Card>
      ) : null}

      {phase === 'ready' && ready ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>PDF 已生成</CardTitle>
                <CardDescription>
                  {ready.pageCount} 页 · {formatBytes(ready.size)} ·{' '}
                  {items.length} 张图片
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button asChild>
                  <a href={ready.url} download={ready.name}>
                    <Download data-icon="inline-start" />
                    下载 PDF
                  </a>
                </Button>
                <Button type="button" variant="outline" onClick={handleReset}>
                  <X data-icon="inline-start" />
                  重新开始
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>页面清单</CardTitle>
                <CardDescription>共 {ready.pageCount} 页</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {items.map((item, index) => (
                    <li
                      key={itemKey(item.file)}
                      className="flex items-center gap-3 rounded-lg border p-2"
                    >
                      {item.thumb ? (
                        <img
                          src={item.thumb}
                          alt=""
                          className="size-8 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <Images className="size-8 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 truncate text-sm">
                        {index + 1} · {item.file.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {ready.failures.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>部分图片处理失败</AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-1">
                  {ready.failures.map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default ImageToPdf
