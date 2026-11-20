import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  List,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  DownloadOutlined,
  FileExcelOutlined,
  FileZipOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ASSET_ARTIFACT_KEYS,
  finalizeAssetJob,
  retryAssetArtifact,
  type AssetArtifact,
  type AssetComparisonJob,
} from '../../../api/asset'
import { readApiErrorMessage } from '../../../api/errors'
import { ASSET_ARTIFACT_LABELS } from './constants'

const { Text } = Typography

const ARTIFACT_STATUS = {
  blocked: { label: '受阻', color: 'default' },
  pending: { label: '等待中', color: 'default' },
  building: { label: '生成中', color: 'processing' },
  ready: { label: '就绪', color: 'success' },
  stale: { label: '待重新生成', color: 'warning' },
  failed: { label: '失败', color: 'error' },
  expired: { label: '已过期', color: 'default' },
} as const

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ArtifactRow({
  artifactKey,
  artifact,
  onRetrying,
  retrying,
}: {
  artifactKey: string
  artifact: AssetArtifact | undefined
  onRetrying: () => void
  retrying: boolean
}) {
  const status = artifact?.status ?? 'pending'
  const meta = ARTIFACT_STATUS[status]
  const canRetry = status === 'failed' || status === 'stale'
  const icon = artifactKey === 'final_bundle' ? <FileZipOutlined /> : <FileExcelOutlined />

  return (
    <List.Item
      actions={[
        artifact?.status === 'ready' && artifact.downloadUrl ? (
          <Button
            key="download"
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            href={artifact.downloadUrl}
            target="_blank"
          >
            下载
          </Button>
        ) : null,
        canRetry ? (
          <Button
            key="retry"
            size="small"
            icon={<ReloadOutlined />}
            loading={retrying}
            onClick={onRetrying}
          >
            重试
          </Button>
        ) : null,
      ].filter(Boolean)}
    >
      <List.Item.Meta
        avatar={icon}
        title={<Text style={{ fontSize: 12 }}>{ASSET_ARTIFACT_LABELS[artifactKey] ?? artifactKey}</Text>}
        description={
          <Space size={6} wrap>
            <Tag color={meta.color} bordered={false}>{meta.label}</Tag>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {formatBytes(artifact?.sizeBytes)}
            </Text>
            {artifact?.filename ? (
              <Text type="secondary" className="mono" style={{ fontSize: 10 }}>
                {artifact.filename}
              </Text>
            ) : null}
            {artifact?.error ? (
              <Tooltip title={artifact.error}>
                <Text
                  type="danger"
                  ellipsis
                  style={{ fontSize: 11, maxWidth: 420 }}
                >
                  {artifact.error}
                </Text>
              </Tooltip>
            ) : null}
          </Space>
        }
      />
    </List.Item>
  )
}

export function AssetArtifactsPanel({
  job,
  onUpdated,
}: {
  job: AssetComparisonJob
  onUpdated: () => void
}) {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()

  const finalizeMutation = useMutation({
    mutationFn: () => finalizeAssetJob(job.jobId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['asset', 'job', job.jobId], updated)
      message.success('已开始生成完整归档包')
      onUpdated()
    },
    onError: (error) => message.error(readApiErrorMessage(error) ?? '归档失败'),
  })

  const retryMutation = useMutation({
    mutationFn: (artifactKey: string) => retryAssetArtifact(job.jobId, artifactKey),
    onSuccess: (updated) => {
      queryClient.setQueryData(['asset', 'job', job.jobId], updated)
      message.success('已开始重新生成')
      onUpdated()
    },
    onError: (error) => message.error(readApiErrorMessage(error) ?? '重试失败'),
  })

  const blockerText = job.finalizeBlockers.map((blocker) => blocker.message).join('；')
  const finalizeDisabled = !job.canFinalize || finalizeMutation.isPending

  return (
    <Card
      variant="outlined"
      title="4. 归档与导出"
      extra={
        <Tooltip title={job.canFinalize ? undefined : blockerText || '当前不可归档'}>
          <Button
            type="primary"
            disabled={finalizeDisabled}
            loading={finalizeMutation.isPending}
            onClick={() => finalizeMutation.mutate()}
          >
            {job.status === 'complete' ? '重新生成归档' : '生成完整归档'}
          </Button>
        </Tooltip>
      }
    >
      <Flex vertical gap={12}>
        {!job.canFinalize && job.finalizeBlockers.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            message="归档前还有待完成项"
            description={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {job.finalizeBlockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.message}</li>
                ))}
              </ul>
            }
          />
        ) : null}
        <List
          dataSource={[...ASSET_ARTIFACT_KEYS]}
          renderItem={(artifactKey) => (
            <ArtifactRow
              artifactKey={artifactKey}
              artifact={job.artifacts[artifactKey]}
              retrying={retryMutation.isPending && retryMutation.variables === artifactKey}
              onRetrying={() => retryMutation.mutate(artifactKey)}
            />
          )}
        />
      </Flex>
    </Card>
  )
}
