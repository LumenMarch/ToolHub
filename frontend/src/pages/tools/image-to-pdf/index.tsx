import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  DownloadSimple,
  FileImage,
  FolderOpen,
  ImagesSquare,
  Trash,
  Warning,
  X,
} from '@phosphor-icons/react';
import { PDFDocument } from 'pdf-lib';
import type { PDFImage } from 'pdf-lib';
import FileDropZone from '../../../components/FileDropZone';
import { LoadingSignal } from '../../../components/LoadingSignal';

/*
 * 图片转 PDF — 纯前端实现:
 * - jpg / jpeg 直通 embedJpg(零解码零重编码,画质无损)
 * - png 直通 embedPng(palette 索引色 PNG 会抛错 → 回退 canvas 转 PNG)
 * - webp 等其余格式:createImageBitmap 解码 → canvas → 导出 PNG 再嵌入
 * - 每张图片一个页面,A4 按图片宽高比自动选竖版/横版,图片 contain 居中
 * - 图片仅在本机浏览器内处理,不上传服务器
 */

interface ImageItem {
  file: File;
  /** 缩略图 data URL(生成失败时为 null,以图标占位) */
  thumb: string | null;
}

interface ReadyState {
  url: string;
  name: string;
  pageCount: number;
  size: number;
  failures: string[];
}

type Phase = 'upload' | 'processing' | 'ready';

/** canvas 单边尺寸上限(Chrome/Safari 通用安全值) */
const MAX_CANVAS_DIMENSION = 16384;
/** 图片数量上限,避免内存失控 */
const MAX_IMAGES = 20;
const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const PAGE_MARGIN = 32;

const isImageFile = (file: File): boolean =>
  file.type.startsWith('image/') ||
  /\.(jpe?g|png|webp|bmp|gif|avif)$/i.test(file.name);

const itemKey = (file: File): string => `${file.name}:${file.size}`;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatTimestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
};

/** 生成 160px 宽的 JPEG 缩略图 data URL;任何失败(超大图/解码失败)返回 null。 */
const generateThumb = async (file: File): Promise<string | null> => {
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 160 });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.85);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
};

/**
 * canvas 路线:解码 → 铺白底 → 导出 PNG → 嵌入。
 * 超出 canvas 边长上限时抛出带文件名上下文的明确错误。
 */
const embedViaCanvas = async (
  doc: PDFDocument,
  file: File,
): Promise<PDFImage> => {
  const bitmap = await createImageBitmap(file);
  try {
    const maxSide = Math.max(bitmap.width, bitmap.height);
    if (
      bitmap.width > MAX_CANVAS_DIMENSION ||
      bitmap.height > MAX_CANVAS_DIMENSION
    ) {
      throw new Error(
        `图片边长 ${maxSide}px 超过 canvas 上限 ${MAX_CANVAS_DIMENSION}px,无法转换`,
      );
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建绘图上下文');
    // 透明图片导出 PNG 保留 alpha,pdf-lib 会生成 SMask;铺白底防 JPEG 类黑底问题。
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) throw new Error('canvas 编码 PNG 失败');
    return await doc.embedPng(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
};

/** 嵌入一张图片并追加一个 A4 页面(横/竖按图片宽高比自动选择),返回是否成功。 */
const appendImagePage = async (
  doc: PDFDocument,
  file: File,
): Promise<boolean> => {
  const type = file.type.toLowerCase();
  let image: PDFImage;
  if (type === 'image/jpeg' || type === 'image/jpg') {
    image = await doc.embedJpg(await file.arrayBuffer());
  } else if (type === 'image/png') {
    try {
      image = await doc.embedPng(await file.arrayBuffer());
    } catch {
      // palette 索引色 PNG 等 pdf-lib 不支持的子类型 → canvas 兜底
      image = await embedViaCanvas(doc, file);
    }
  } else {
    image = await embedViaCanvas(doc, file);
  }

  const { width, height } = image;
  const portrait = height >= width;
  const [pageW, pageH] = portrait ? A4_PORTRAIT : A4_LANDSCAPE;
  const scale = Math.min(
    (pageW - 2 * PAGE_MARGIN) / width,
    (pageH - 2 * PAGE_MARGIN) / height,
  );
  const drawW = width * scale;
  const drawH = height * scale;
  const page = doc.addPage([pageW, pageH]);
  page.drawImage(image, {
    x: (pageW - drawW) / 2,
    y: (pageH - drawH) / 2,
    width: drawW,
    height: drawH,
  });
  return true;
};

const Metric: React.FC<{ label: string; value: string | number }> = ({
  label,
  value,
}) => (
  <div className="border-t border-border pt-4">
    <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted-foreground">
      {label}
    </p>
    <p className="mt-1 text-xl font-bold tracking-tight">{value}</p>
  </div>
);

const ImageToPdf: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('upload');
  const [items, setItems] = useState<ImageItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    name: string;
  } | null>(null);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const urlRef = useRef<string | null>(null);
  // 事件处理器同步读取的镜像:避免闭包捕获过期 items 导致追加丢失/覆盖。
  const itemsRef = useRef<ImageItem[]>([]);
  const directoryInputRef = useRef<HTMLInputElement>(null);

  // 组件卸载时释放下载 object URL。
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  /** 统一的状态更新入口:updater 是纯函数(只读 ref 计算 next),ref 写入发生在函数体而非 updater 回调内。 */
  const updateItems = (updater: (prev: ImageItem[]) => ImageItem[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  };

  const handleSelectMultiple = (files: File[]) => {
    const images = files.filter(isImageFile);
    const rejected = files.length - images.length;
    const prev = itemsRef.current;
    const existing = new Set(prev.map((item) => itemKey(item.file)));
    const fresh = images.filter((file) => !existing.has(itemKey(file)));
    const duplicateCount = images.length - fresh.length;
    const room = Math.max(0, MAX_IMAGES - prev.length);
    const added = fresh.slice(0, room);
    const overflow = fresh.length - added.length;
    const ignored = rejected + duplicateCount + overflow;

    if (added.length === 0) {
      if (ignored > 0) {
        setNotice(
          `已忽略 ${ignored} 个文件(重复、非图片或超出 ${MAX_IMAGES} 张上限)`,
        );
      }
      return;
    }

    setError(null);
    setNotice(
      ignored > 0
        ? `已忽略 ${ignored} 个文件(重复、非图片或超出 ${MAX_IMAGES} 张上限)`
        : null,
    );
    updateItems((p) => [...p, ...added.map((file) => ({ file, thumb: null }))]);
    for (const file of added) {
      void generateThumb(file).then((thumb) => {
        updateItems((p) => {
          const index = p.findIndex((item) => item.file === file);
          if (index === -1) return p;
          const next = [...p];
          next[index] = { ...next[index], thumb };
          return next;
        });
      });
    }
  };

  const handleDirectoryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length === 0) return;
    // 文件夹选择:webkitRelativePath 已含子目录路径,按路径排序保证确定性顺序。
    const sorted = [...files].sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(
        b.webkitRelativePath || b.name,
        undefined,
        { numeric: true, sensitivity: 'base' },
      ),
    );
    handleSelectMultiple(sorted);
  };

  const moveItem = (index: number, delta: -1 | 1) => {
    updateItems((p) => {
      const target = index + delta;
      if (target < 0 || target >= p.length) return p;
      const next = [...p];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeItem = (index: number) => {
    updateItems((p) => p.filter((_, i) => i !== index));
  };

  const handleReset = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setReady(null);
    updateItems(() => []);
    setError(null);
    setNotice(null);
    setPhase('upload');
  };

  const handleConvert = async () => {
    if (items.length === 0 || phase === 'processing') return;
    setPhase('processing');
    setError(null);
    setReady(null);

    const doc = await PDFDocument.create();
    const failures: string[] = [];
    let pageCount = 0;
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setProgress({ done: i, total: items.length, name: item.file.name });
        try {
          if (await appendImagePage(doc, item.file)) pageCount += 1;
        } catch (err) {
          failures.push(
            `${item.file.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (pageCount === 0) {
        setError('所有图片均处理失败,未生成 PDF');
        setPhase('upload');
        return;
      }

      const pdfBytes = await doc.save();
      const blob = new Blob([pdfBytes.slice()], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setReady({
        url,
        name: `图片转PDF-${formatTimestamp()}.pdf`,
        pageCount,
        size: blob.size,
        failures,
      });
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成 PDF 失败');
      setPhase('upload');
    } finally {
      setProgress(null);
    }
  };

  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  const jpegCount = items.filter((item) =>
    /^image\/jpe?g$/i.test(item.file.type),
  ).length;

  return (
    <div className="flex w-full flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto">
      <p className="mb-8 max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-[0.18em] text-muted-foreground md:text-sm">
        选择单张或多张图片,或拖入整个文件夹(含子目录),按列表顺序合并为单个
        PDF。每张图片一页,页面自动适配 A4 横竖方向。
      </p>

      {phase === 'upload' && (
        <>
          <section
            className="border-2 border-border"
            aria-labelledby="image-upload-title"
          >
            <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
              <div className="min-w-0 p-6 md:p-8 lg:p-10">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                  [ IMAGES:{' '}
                  {items.length > 0
                    ? `${items.length} FILES · ${formatBytes(totalBytes)}`
                    : 'NO FILES'}{' '}
                  ]
                </p>
                <h2
                  id="image-upload-title"
                  className="mt-4 text-3xl font-bold tracking-tight md:text-4xl"
                >
                  选择图片
                </h2>

                <div className="mt-8">
                  <FileDropZone
                    id="image-files"
                    label="01 / 图片文件"
                    description="支持 jpg / png / webp 等常见图片格式;可拖入图片或文件夹(含子目录)。"
                    accept="image/*"
                    multiple
                    file={items[0]?.file ?? null}
                    onSelect={(file) => handleSelectMultiple([file])}
                    onSelectMultiple={handleSelectMultiple}
                    onClear={handleReset}
                  />
                  <div className="mt-4 flex items-center justify-between gap-4">
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
                    <button
                      type="button"
                      onClick={() => directoryInputRef.current?.click()}
                      className="inline-flex min-h-11 items-center gap-2 border-2 border-dashed border-border px-5 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      <FolderOpen weight="bold" className="size-4" />
                      选择文件夹
                    </button>
                    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted-foreground">
                      自动递归收集子目录图片
                    </span>
                  </div>
                </div>

                {items.length > 0 && (
                  <>
                    <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-7 xl:grid-cols-4">
                      <Metric label="图片数" value={items.length} />
                      <Metric label="总大小" value={formatBytes(totalBytes)} />
                      <Metric label="JPEG 直通" value={jpegCount} />
                      <Metric label="预估页数" value={items.length} />
                    </div>

                    <div className="mt-6 border-t border-border pt-5">
                      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted-foreground">
                        已选图片 · 按序合并
                      </p>
                      <ul className="mt-3 grid gap-1">
                        {items.map((item, index) => (
                          <li
                            key={itemKey(item.file)}
                            className="flex items-center gap-4 border-b border-border/60 py-3"
                          >
                            {item.thumb ? (
                              <img
                                src={item.thumb}
                                alt=""
                                className="size-14 shrink-0 border border-border bg-background object-cover"
                              />
                            ) : (
                              <span className="flex size-14 shrink-0 items-center justify-center border border-border bg-background">
                                <FileImage
                                  weight="bold"
                                  className="size-5 text-muted-foreground"
                                />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-mono text-xs">
                                {index + 1}. {item.file.name}
                              </p>
                              <p className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">
                                {formatBytes(item.file.size)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => moveItem(index, -1)}
                                disabled={index === 0}
                                aria-label={`上移 ${item.file.name}`}
                                className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <ArrowUp weight="bold" className="size-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveItem(index, 1)}
                                disabled={index === items.length - 1}
                                aria-label={`下移 ${item.file.name}`}
                                className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <ArrowDown weight="bold" className="size-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeItem(index)}
                                aria-label={`移除 ${item.file.name}`}
                                className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-primary"
                              >
                                <Trash weight="bold" className="size-4" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>

              <aside className="flex min-w-0 flex-col justify-between border-t border-border bg-muted p-6 md:p-8 lg:border-l lg:border-t-0 lg:p-10">
                <div>
                  <FileImage weight="bold" className="size-9 text-primary" />
                  <h3 className="mt-6 text-2xl font-bold">合并规则</h3>
                  <ul className="mt-6 grid gap-3 font-mono text-xs">
                    {[
                      '每张图片一个页面,按列表顺序合并',
                      '可拖入图片或文件夹(含子目录),文件夹按路径排序后合并',
                      '页面自动选择 A4 竖版 / 横版,图片等比居中适配',
                      'jpg / png 无损直通嵌入,其余格式经 canvas 转 PNG',
                      '同名同大小文件视为重复,自动去重',
                      `单张图片边长上限 ${MAX_CANVAS_DIMENSION}px,超出将提示失败`,
                    ].map((rule) => (
                      <li
                        key={rule}
                        className="break-words border border-border bg-background px-4 py-3"
                      >
                        {rule}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-8 font-mono text-xs leading-relaxed text-muted-foreground">
                  图片仅在本机浏览器内处理,不会上传服务器。
                </p>
              </aside>
            </div>
          </section>

          <div className="mt-8 flex flex-col gap-6 border-t-2 border-border pt-8 md:flex-row md:items-center">
            <button
              type="button"
              onClick={() => void handleConvert()}
              disabled={items.length === 0}
              className="flex min-h-14 items-center justify-center gap-3 whitespace-nowrap bg-foreground px-8 py-4 text-lg font-bold uppercase tracking-tight text-background transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FileImage weight="bold" className="size-6" />
              合并为 PDF
            </button>
            <div className="min-h-12 flex-1 font-mono text-sm leading-relaxed">
              {notice && (
                <p role="status" className="text-muted-foreground">
                  [ 提示 ] {notice}
                </p>
              )}
              {error && (
                <p role="alert" className="text-primary">
                  [ 异常 ] {error}
                </p>
              )}
              {!items.length && !notice && !error && (
                <p className="text-muted-foreground">
                  请先选择至少一张图片。
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {phase === 'processing' && (
        <section className="flex min-h-96 flex-col justify-start gap-8 border-2 border-border p-6 md:p-10">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                [ 生成中{' '}
                {progress ? `${progress.done + 1}/${progress.total}` : '…'}{' '}
                ]
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                正在合并 PDF
              </h2>
            </div>
          </div>
          <LoadingSignal
            ariaLabel="生成 PDF 中"
            meta="ImageToPDF / Embed"
            label="[ 图片转 PDF · 生成中 ]"
            detail={progress ? `正在嵌入 ${progress.name}` : '等待处理'}
            className="max-w-2xl"
          />
        </section>
      )}

      {phase === 'ready' && ready && (
        <>
          <section
            className="border-2 border-border"
            aria-labelledby="pdf-result-title"
          >
            <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
              <div className="min-w-0 p-6 md:p-8 lg:p-10">
                <div className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.2em] text-status-success-foreground">
                      [ 合并完成 ]
                    </p>
                    <h2
                      id="pdf-result-title"
                      className="mt-3 text-3xl font-bold tracking-tight md:text-4xl"
                    >
                      PDF 已生成
                    </h2>
                    <p className="mt-3 font-mono text-xs text-muted-foreground">
                      {ready.pageCount} 页 · {formatBytes(ready.size)} ·{' '}
                      {items.length} 张图片
                    </p>
                  </div>
                </div>

                <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-center">
                  <a
                    href={ready.url}
                    download={ready.name}
                    className="flex min-h-14 items-center justify-center gap-3 whitespace-nowrap bg-foreground px-8 py-4 text-lg font-bold uppercase tracking-tight text-background transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    <DownloadSimple weight="bold" className="size-6" />
                    下载 PDF
                  </a>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex min-h-14 items-center justify-center gap-2 whitespace-nowrap font-mono text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    <X weight="bold" className="size-4" />
                    重新开始
                  </button>
                </div>
              </div>

              <aside className="flex min-w-0 flex-col justify-between border-t border-border bg-muted p-6 md:p-8 lg:border-l lg:border-t-0 lg:p-10">
                <div>
                  <ImagesSquare weight="bold" className="size-9 text-primary" />
                  <h3 className="mt-6 text-2xl font-bold">页面清单</h3>
                  <ul className="mt-6 grid gap-2 font-mono text-xs">
                    {items.map((item, index) => (
                      <li
                        key={itemKey(item.file)}
                        className="flex items-center gap-3 border border-border bg-background px-3 py-2"
                      >
                        {item.thumb ? (
                          <img
                            src={item.thumb}
                            alt=""
                            className="size-8 shrink-0 object-cover"
                          />
                        ) : (
                          <FileImage
                            weight="bold"
                            className="size-8 shrink-0 text-muted-foreground"
                          />
                        )}
                        <span className="min-w-0 truncate">
                          {index + 1} · {item.file.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-8 font-mono text-xs leading-relaxed text-muted-foreground">
                  共 {ready.pageCount} 页 PDF
                </p>
              </aside>
            </div>
          </section>

          {ready.failures.length > 0 && (
            <section
              role="alert"
              aria-label="处理错误"
              className="mt-8 border-2 border-status-danger-foreground/40 bg-status-danger-surface p-6"
            >
              <div className="flex items-start gap-4">
                <Warning
                  weight="fill"
                  className="mt-1 size-6 shrink-0 text-status-danger-foreground"
                />
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-status-danger-foreground">
                    [ 部分图片处理失败 ]
                  </p>
                  <ul className="mt-3 grid gap-1 font-mono text-xs">
                    {ready.failures.map((failure) => (
                      <li
                        key={failure}
                        className="text-status-danger-foreground"
                      >
                        {failure}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default ImageToPdf;
