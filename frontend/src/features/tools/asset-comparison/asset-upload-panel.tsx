import { useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  List,
  Progress,
  Tag,
  Typography,
  Upload,
  theme,
} from 'antd'
import type { UploadProps } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  FileExcelOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import type { AssetComparisonJob, AssetScanResponse } from '../../../api/asset'
import { createAssetJob, scanAssetFiles } from '../../../api/asset'
import { readApiErrorMessage } from '../../../api/errors'
import { useTusUpload } from '../../upload/use-tus-upload'
import {
  ASSET_INPUT_FIELDS,
  ASSET_INPUT_GROUPS,
  ASSET_REQUIRED_COUNT,
} from './constants'

const { Text } = Typography

const ACCEPT = '.xlsx,.xls,.csv'

function fileKey(file: File): string {
  return `${file.name}:${file.size}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function createClientRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function AssetUploadPanel({
  onJobStarted,
}: {
  onJobStarted: (job: AssetComparisonJob) => void
}) {
  const { token } = theme.useToken()
  const { message } = AntApp.useApp()
  const [files, setFiles] = useState<File[]>([])
  const [scan, setScan] = useState<AssetScanResponse | null>(null)
  const [currentFile, setCurrentFile] = useState('')
  const [scanning, setScanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const upload = useTusUpload()

  const clearScan = () => setScan(null)

  const addFiles = (incoming: File[]) => {
    const accepted = incoming.filter((file) =>
      /\.(xlsx|xls|csv)$/i.test(file.name),
    )
    if (accepted.length === 0) {
      message.warning('请选择 xlsx / xls / csv 文件')
      return
    }
    setFiles((previous) => {
      const existing = new Set(previous.map(fileKey))
      const fresh: File[] = []
      for (const file of accepted) {
        const key = fileKey(file)
        if (existing.has(key)) continue
        existing.add(key)
        fresh.push(file)
      }
      return [...previous, ...fresh]
    })
    clearScan()
  }

  const removeFile = (key: string) => {
    setFiles((previous) => previous.filter((file) => fileKey(file) !== key))
    clearScan()
  }

  const handleUploadAndScan = async () => {
    if (files.length === 0 || scanning) return
    setScanning(true)
    setError('')
    setScan(null)
    upload.reset()
    try {
      const uploadIds: string[] = []
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        setCurrentFile(`${index + 1}/${files.length} · ${file.name}`)
        uploadIds.push(await upload.upload(file))
      }
      const scanResponse = await scanAssetFiles(uploadIds)
      setScan(scanResponse)
      const matched = ASSET_INPUT_FIELDS.filter((field) => scanResponse.data[field.key]).length
      if (matched === ASSET_REQUIRED_COUNT) {
        message.success(`已匹配全部 ${ASSET_REQUIRED_COUNT} 个数据源`)
      } else {
        message.warning(`已匹配 ${matched}/${ASSET_REQUIRED_COUNT} 个数据源，请补齐缺失文件后重新上传`)
      }
    } catch (uploadError) {
      setError(
        readApiErrorMessage(uploadError) ??
          (uploadError instanceof Error ? uploadError.message : '上传或扫描失败'),
      )
    } finally {
      setScanning(false)
      setCurrentFile('')
    }
  }

  const matchedCount = scan
    ? ASSET_INPUT_FIELDS.filter((field) => scan.data[field.key]).length
    : 0
  const allMatched = matchedCount === ASSET_REQUIRED_COUNT

  const handleStart = async () => {
    if (!scan || !allMatched || starting) return
    setStarting(true)
    setError('')
    try {
      const job = await createAssetJob(scan.scan_id, createClientRequestId())
      message.success(job.reused ? '已恢复相同的核对任务' : '核对任务已创建')
      onJobStarted(job)
    } catch (startError) {
      setError(readApiErrorMessage(startError) ?? '创建核对任务失败')
    } finally {
      setStarting(false)
    }
  }

  const uploadProps: UploadProps = {
    multiple: true,
    accept: ACCEPT,
    showUploadList: false,
    disabled: scanning,
    beforeUpload: (file) => {
      addFiles([file])
      return Upload.LIST_IGNORE
    },
  }

  return (
    <Flex vertical gap={14}>
      <Card
        variant="outlined"
        title="1. 准备数据源"
        extra={<Tag bordered={false}>{ASSET_REQUIRED_COUNT} 个必需数据源</Tag>}
      >
        <Flex vertical gap={14}>
          <Alert
            type="info"
            showIcon
            message="选择一个包含全部数据源的文件夹"
            description="文件名需要包含财务、SFC、Notes、客户及对应年月；部门、保管人和 DRI 配置文件按关键词匹配。"
          />

          <Flex gap={10} wrap>
            <Upload {...uploadProps} directory>
              <Button icon={<FolderOpenOutlined />} disabled={scanning}>
                选择文件夹
              </Button>
            </Upload>
            <Upload {...uploadProps}>
              <Button icon={<PlusOutlined />} disabled={scanning}>
                选择文件
              </Button>
            </Upload>
            <Button
              type="primary"
              icon={<InboxOutlined />}
              loading={scanning}
              disabled={files.length === 0}
              onClick={() => void handleUploadAndScan()}
            >
              上传并扫描
            </Button>
            <Button
              onClick={() => {
                setFiles([])
                setScan(null)
                setError('')
                upload.reset()
              }}
              disabled={scanning || files.length === 0}
            >
              清空
            </Button>
          </Flex>

          {error ? (
            <Alert type="error" showIcon closable message={error} onClose={() => setError('')} />
          ) : null}

          {scanning ? (
            <div>
              <Flex justify="space-between" align="center" style={{ marginBottom: 4 }}>
                <Text type="secondary">{currentFile || '准备上传…'}</Text>
                <Text type="secondary">
                  {upload.phase === 'hashing'
                    ? '计算摘要'
                    : upload.phase === 'cache-checking'
                      ? '检查缓存'
                      : upload.phase === 'completed'
                        ? '已上传'
                        : upload.phase === 'uploading' || upload.phase === 'confirming'
                          ? `${upload.progress}%`
                          : ''}
                </Text>
              </Flex>
              <Progress
                percent={upload.progress}
                status={upload.phase === 'error' ? 'exception' : 'active'}
                strokeColor={token.colorPrimary}
              />
            </div>
          ) : null}

          {files.length > 0 ? (
            <List
              size="small"
              dataSource={files}
              style={{ maxHeight: 260, overflowY: 'auto' }}
              renderItem={(file) => (
                <List.Item
                  style={{ paddingInline: 0 }}
                  actions={[
                    <Button
                      key="remove"
                      type="text"
                      size="small"
                      danger
                      aria-label="移除文件"
                      icon={<DeleteOutlined />}
                      disabled={scanning}
                      onClick={() => removeFile(fileKey(file))}
                    />,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<FileExcelOutlined style={{ color: token.colorSuccess }} />}
                    title={<Text style={{ fontSize: 12 }} ellipsis>{file.name}</Text>}
                    description={<Text type="secondary" style={{ fontSize: 11 }}>{formatBytes(file.size)}</Text>}
                  />
                </List.Item>
              )}
            />
          ) : null}

          {scan ? (
            <Flex vertical gap={12}>
              <Alert
                type={allMatched ? 'success' : 'warning'}
                showIcon
                message={`已匹配 ${matchedCount} / ${ASSET_REQUIRED_COUNT} 个数据源`}
                description={
                  allMatched
                    ? '全部数据源已就绪，可以创建核对任务。'
                    : '缺失项已在下方标红。请补齐文件后重新选择完整文件夹并上传扫描。'
                }
              />
              <Flex gap={12} wrap>
                {ASSET_INPUT_GROUPS.map((group) => (
                  <Card
                    key={group.key}
                    size="small"
                    variant="outlined"
                    title={group.label}
                    extra={<Text type="secondary" style={{ fontSize: 10 }}>{group.hint}</Text>}
                    style={{ flex: '1 1 220px', minWidth: 220 }}
                    styles={{ body: { padding: '8px 12px' } }}
                  >
                    <Flex vertical gap={6}>
                      {group.fields.map((field) => {
                        const filename = scan.data[field.key]
                        return (
                          <Flex key={field.key} align="center" gap={6}>
                            {filename ? (
                              <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 12 }} />
                            ) : (
                              <CloseCircleFilled style={{ color: token.colorError, fontSize: 12 }} />
                            )}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <Text style={{ fontSize: 11, display: 'block' }}>{field.label}</Text>
                              <Text
                                type={filename ? 'secondary' : 'danger'}
                                ellipsis
                                style={{ fontSize: 10 }}
                              >
                                {filename || '缺失'}
                              </Text>
                            </div>
                          </Flex>
                        )
                      })}
                    </Flex>
                  </Card>
                ))}
              </Flex>
              <Flex justify="flex-end">
                <Button
                  type="primary"
                  size="large"
                  icon={<PlayCircleOutlined />}
                  disabled={!allMatched}
                  loading={starting}
                  onClick={() => void handleStart()}
                >
                  开始核对
                </Button>
              </Flex>
            </Flex>
          ) : null}
        </Flex>
      </Card>
    </Flex>
  )
}
