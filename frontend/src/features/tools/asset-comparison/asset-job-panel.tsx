import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Progress,
  Space,
  Tag,
  theme,
  Typography,
} from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons'
import type { AssetComparisonJob } from '../../../api/asset'
import { parseServerDate } from '../../../lib/date'
import {
  ASSET_JOB_STATUS_META,
  ASSET_MODULE_KEYS,
  ASSET_MODULE_LABELS,
} from './constants'

const { Text } = Typography

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = parseServerDate(value)
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : value
}

function resultStatusTag(result: AssetComparisonJob['results'][number] | undefined) {
  if (!result) return <Tag bordered={false}>等待中</Tag>
  if (result.status === 'ready') {
    return result.has_diff ? (
      <Tag color="gold" bordered={false}>有差异</Tag>
    ) : (
      <Tag color="success" bordered={false}>
        <CheckCircleFilled /> 无差异
      </Tag>
    )
  }
  if (result.status === 'failed') {
    return (
      <Tag color="error" bordered={false}>
        <CloseCircleFilled /> 失败
      </Tag>
    )
  }
  if (result.status === 'pending') {
    return <Tag bordered={false}>等待中</Tag>
  }
  return (
    <Tag color="processing" bordered={false}>
      <LoadingOutlined /> 处理中
    </Tag>
  )
}

export function AssetJobPanel({
  job,
  refreshing,
  canceling,
  onRefresh,
  onCancel,
}: {
  job: AssetComparisonJob
  refreshing: boolean
  canceling: boolean
  onRefresh: () => void
  onCancel: () => void
}) {
  const { token } = theme.useToken()
  const meta = ASSET_JOB_STATUS_META[job.status]
  const comparison = job.progress.comparison
  const artifacts = job.progress.moduleArtifacts
  const comparisonPercent =
    comparison && comparison.total > 0
      ? Math.round((comparison.completed / comparison.total) * 100)
      : meta.active
        ? 0
        : 100

  const resultByKey = new Map(job.results.map((result) => [result.key, result]))

  return (
    <Card
      variant="outlined"
      title={
        <Flex align="center" gap={10} wrap>
          <span>2. 核对任务</span>
          <Tag color={meta.color} bordered={false}>{meta.label}</Tag>
          <Text type="secondary" className="mono" style={{ fontSize: 11 }}>
            {job.jobId}
          </Text>
        </Flex>
      }
      extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
            刷新
          </Button>
          {meta.active ? (
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              loading={canceling}
              onClick={onCancel}
            >
              取消任务
            </Button>
          ) : null}
        </Space>
      }
    >
      <Flex vertical gap={16}>
        {job.error ? <Alert type="error" showIcon message={job.error} /> : null}

        <Descriptions
          size="small"
          column={{ xs: 1, md: 3 }}
          items={[
            { key: 'status', label: '状态', children: <Tag color={meta.color} bordered={false}>{meta.label}</Tag> },
            { key: 'created', label: '创建时间', children: formatDate(job.createdAt) },
            { key: 'expires', label: '过期时间', children: formatDate(job.expiresAt) },
            { key: 'validation', label: '输入校验', children: job.progress.validation?.status ?? 'pending' },
            { key: 'comparison', label: '模块完成', children: `${comparison?.completed ?? 0} / ${comparison?.total ?? 7}` },
            { key: 'artifacts', label: '模块文件', children: `${artifacts?.completed ?? 0} / ${artifacts?.total ?? 7}` },
          ]}
        />

        <div>
          <Flex justify="space-between" align="center" style={{ marginBottom: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>总体进度</Text>
            <Text strong className="mono">{comparisonPercent}%</Text>
          </Flex>
          <Progress
            percent={comparisonPercent}
            status={job.status === 'failed' ? 'exception' : meta.active ? 'active' : 'normal'}
            strokeColor={job.status === 'failed' ? token.colorError : token.colorPrimary}
            showInfo={false}
          />
        </div>

        <Flex vertical gap={8}>
          {ASSET_MODULE_KEYS.map((key) => {
            const result = resultByKey.get(key)
            return (
              <Flex key={key} align="center" gap={10} wrap>
                <Text style={{ width: 100, fontSize: 12 }}>{ASSET_MODULE_LABELS[key]}</Text>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <Progress
                    percent={
                      result?.status === 'ready' || result?.status === 'failed' ? 100 : 0
                    }
                    size="small"
                    showInfo={false}
                    status={result?.status === 'failed' ? 'exception' : 'normal'}
                    strokeColor={
                      result?.status === 'failed'
                        ? token.colorError
                        : result?.status === 'ready'
                          ? result.has_diff
                            ? token.colorWarning
                            : token.colorSuccess
                          : token.colorPrimary
                    }
                  />
                </div>
                {resultStatusTag(result)}
                {result?.counts ? (
                  <Text type="secondary" style={{ fontSize: 10 }}>
                    新增 {result.counts.new} · 移除 {result.counts.removed} · 异常 {result.counts.anomaly}
                  </Text>
                ) : null}
              </Flex>
            )
          })}
        </Flex>

        {job.status === 'base_ready' ? (
          <Alert
            type="success"
            showIcon
            message="核对完成，可以开始差异复核"
            description="复核完成且基础文件就绪后，可以生成完整归档包。"
          />
        ) : null}
      </Flex>
    </Card>
  )
}
