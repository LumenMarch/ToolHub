import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Image,
  List,
  Progress,
  Row,
  Space,
  Tag,
  theme,
  Typography,
  Upload,
} from 'antd'
import type { UploadProps } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FilePdfOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { PDFDocument } from 'pdf-lib'
import { PageHeader } from '../../../app/components/page-header'

const { Text } = Typography
const { Dragger } = Upload

const MAX_IMAGES = 20
const MAX_CANVAS_DIMENSION = 16_384
const A4_PORTRAIT: [number, number] = [595.28, 841.89]
const A4_LANDSCAPE: [number, number] = [841.89, 595.28]
const PAGE_MARGIN = 32

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|bmp|gif|avif)$/i

interface ImageItem {
  key: string
  file: File
  previewUrl: string
}

interface PdfResult {
  url: string
  filename: string
  size: number
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function timestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

async function embedImage(doc: PDFDocument, file: File) {
  const type = file.type.toLowerCase()
  const bytes = await file.arrayBuffer()

  if (type === 'image/jpeg' || type === 'image/jpg') return doc.embedJpg(bytes)
  if (type === 'image/png') return doc.embedPng(bytes)

  const bitmap = await createImageBitmap(file)
  try {
    if (Math.max(bitmap.width, bitmap.height) > MAX_CANVAS_DIMENSION) {
      throw new Error('图片边长超过 16384px')
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片画布')
    context.drawImage(bitmap, 0, 0)
    const { promise, resolve } = Promise.withResolvers<Blob | null>()
    canvas.toBlob(resolve, 'image/png')
    const blob = await promise
    if (!blob) throw new Error('图片转换失败')
    return doc.embedPng(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

async function buildPdf(items: ImageItem[], onProgress: (done: number) => void) {
  const doc = await PDFDocument.create()
  const failures: string[] = []
  let done = 0

  for (const item of items) {
    try {
      const image = await embedImage(doc, item.file)
      const portrait = image.height >= image.width
      const [pageWidth, pageHeight] = portrait ? A4_PORTRAIT : A4_LANDSCAPE
      const scale = Math.min(
        (pageWidth - PAGE_MARGIN * 2) / image.width,
        (pageHeight - PAGE_MARGIN * 2) / image.height,
        1,
      )
      const width = image.width * scale
      const height = image.height * scale
      const page = doc.addPage([pageWidth, pageHeight])
      page.drawImage(image, {
        x: (pageWidth - width) / 2,
        y: (pageHeight - height) / 2,
        width,
        height,
      })
    } catch {
      failures.push(item.file.name)
    } finally {
      done += 1
      onProgress(done)
    }
  }

  if (doc.getPageCount() === 0) {
    throw new Error('没有可转换的图片')
  }

  const bytes = await doc.save()
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  return { blob, failures }
}

export function ImageToPdfPage() {
  const { token } = theme.useToken()
  const [items, setItems] = useState<ImageItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<PdfResult | null>(null)
  const [error, setError] = useState('')
  const [failures, setFailures] = useState<string[]>([])
  const itemsRef = useRef(items)
  const resultRef = useRef<PdfResult | null>(null)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    resultRef.current = result
  }, [result])

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url)
    }
  }, [])

  const clearResult = () => {
    setResult((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return null
    })
    setFailures([])
    setError('')
  }

  const addFiles = (incoming: File[]) => {
    const images = incoming.filter(isImageFile)
    if (images.length === 0) return
    clearResult()

    setItems((previous) => {
      const existing = new Set(previous.map((item) => `${item.file.name}:${item.file.size}`))
      const fresh: ImageItem[] = []
      for (const file of images) {
        const key = `${file.name}:${file.size}`
        if (existing.has(key)) continue
        existing.add(key)
        fresh.push({ key, file, previewUrl: URL.createObjectURL(file) })
      }
      const room = Math.max(0, MAX_IMAGES - previous.length)
      const accepted = fresh.slice(0, room)
      for (const rejected of fresh.slice(room)) URL.revokeObjectURL(rejected.previewUrl)
      return [...previous, ...accepted]
    })
  }

  const removeItem = (key: string) => {
    clearResult()
    setItems((previous) => {
      const target = previous.find((item) => item.key === key)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return previous.filter((item) => item.key !== key)
    })
  }

  const moveItem = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    clearResult()
    setItems((previous) => {
      const next = [...previous]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const resetAll = () => {
    for (const item of items) URL.revokeObjectURL(item.previewUrl)
    if (result) URL.revokeObjectURL(result.url)
    setItems([])
    setResult(null)
    setFailures([])
    setError('')
    setProgress(0)
  }

  const handleConvert = async () => {
    if (items.length === 0 || processing) return
    setProcessing(true)
    setError('')
    setFailures([])
    setProgress(0)
    try {
      const { blob, failures: failed } = await buildPdf(items, setProgress)
      const url = URL.createObjectURL(blob)
      const filename = `images_${timestamp()}.pdf`
      setResult({ url, filename, size: blob.size })
      setFailures(failed)
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : '转换失败，请稍后重试。')
    } finally {
      setProcessing(false)
    }
  }

  const uploadProps: UploadProps = {
    multiple: true,
    accept: '.jpg,.jpeg,.png,.webp,.bmp,.gif,.avif',
    showUploadList: false,
    beforeUpload: (file) => {
      addFiles([file])
      return Upload.LIST_IGNORE
    },
  }

  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="图片转 PDF"
        description="将多张图片按顺序合并为单个 A4 PDF，页面自动选择横版或竖版。"
        actions={
          <Space>
            <Upload {...uploadProps} directory>
              <Button icon={<FolderOpenOutlined />}>选择文件夹</Button>
            </Upload>
            <Button icon={<ReloadOutlined />} onClick={resetAll} disabled={items.length === 0}>
              清空
            </Button>
          </Space>
        }
      />

      {error ? (
        <Alert type="error" showIcon closable message={error} onClose={() => setError('')} />
      ) : null}
      {failures.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`${failures.length} 张图片转换失败`}
          description={failures.join('、')}
        />
      ) : null}

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={13}>
          <Card
            variant="outlined"
            title="图片列表"
            extra={<Text type="secondary">{items.length} / {MAX_IMAGES}</Text>}
            style={{ height: '100%' }}
          >
            <Dragger {...uploadProps} style={{ marginBottom: 16 }}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">拖放图片到此处，或点击选择</p>
              <p className="ant-upload-hint">
                支持 jpg / png / webp / bmp / gif / avif，最多 {MAX_IMAGES} 张，重复文件自动忽略。
              </p>
            </Dragger>

            {items.length > 0 ? (
              <List
                dataSource={items}
                renderItem={(item, index) => (
                  <List.Item
                    style={{ paddingInline: 0 }}
                    actions={[
                      <Button
                        key="up"
                        type="text"
                        size="small"
                        aria-label="上移"
                        icon={<ArrowUpOutlined />}
                        disabled={index === 0 || processing}
                        onClick={() => moveItem(index, -1)}
                      />,
                      <Button
                        key="down"
                        type="text"
                        size="small"
                        aria-label="下移"
                        icon={<ArrowDownOutlined />}
                        disabled={index === items.length - 1 || processing}
                        onClick={() => moveItem(index, 1)}
                      />,
                      <Button
                        key="remove"
                        type="text"
                        size="small"
                        danger
                        aria-label="移除"
                        icon={<DeleteOutlined />}
                        disabled={processing}
                        onClick={() => removeItem(item.key)}
                      />,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={
                        <Image
                          src={item.previewUrl}
                          alt={item.file.name}
                          width={44}
                          height={44}
                          style={{ objectFit: 'cover', borderRadius: 8 }}
                          preview={false}
                        />
                      }
                      title={
                        <Text ellipsis style={{ fontSize: 12 }}>
                          {index + 1}. {item.file.name}
                        </Text>
                      }
                      description={
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {formatBytes(item.file.size)}
                        </Text>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : null}
          </Card>
        </Col>

        <Col xs={24} lg={11}>
          <Card
            variant="outlined"
            title="生成 PDF"
            extra={<Tag bordered={false}>A4 · 自动横竖版</Tag>}
            style={{ height: '100%' }}
          >
            <Flex vertical gap={16}>
              <Flex
                align="center"
                gap={12}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  background: token.colorFillQuaternary,
                }}
              >
                <FilePdfOutlined style={{ fontSize: 26, color: token.colorPrimary }} />
                <div style={{ flex: 1 }}>
                  <Text strong style={{ display: 'block' }}>
                    {items.length} 张图片
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    每张图片一页，等比居中，远小于 A4 时不放大。
                  </Text>
                </div>
              </Flex>

              {processing ? (
                <div>
                  <Flex justify="space-between" style={{ marginBottom: 4 }}>
                    <Text type="secondary">正在生成 PDF</Text>
                    <Text type="secondary">{progress} / {items.length}</Text>
                  </Flex>
                  <Progress percent={Math.round((progress / Math.max(items.length, 1)) * 100)} />
                </div>
              ) : null}

              <Button
                type="primary"
                size="large"
                block
                icon={<FilePdfOutlined />}
                loading={processing}
                disabled={items.length === 0}
                onClick={() => void handleConvert()}
              >
                生成 PDF
              </Button>

              {result ? (
                <Card
                  size="small"
                  variant="outlined"
                  styles={{ body: { padding: 14 } }}
                  style={{ borderColor: token.colorPrimaryBorder }}
                >
                  <Flex align="center" gap={12}>
                    <FilePdfOutlined style={{ fontSize: 26, color: token.colorSuccess }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong ellipsis style={{ display: 'block' }}>
                        {result.filename}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatBytes(result.size)} · 已生成
                      </Text>
                    </div>
                    <a href={result.url} download={result.filename}>
                      <Button type="primary" icon={<DownloadOutlined />}>
                        下载
                      </Button>
                    </a>
                  </Flex>
                </Card>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="生成后可在这里下载 PDF"
                />
              )}

              <Alert
                type="info"
                showIcon
                message="转换在本机完成"
                description="图片不会上传到服务器；关闭页面后临时文件会自动释放。"
              />
            </Flex>
          </Card>
        </Col>
      </Row>
    </Flex>
  )
}
