import { useState } from 'react'
import { Card, Flex, Space, Tabs, Tag, Typography } from 'antd'
import type { AssetComparisonJob, AssetModuleKey } from '../../../api/asset'
import { ASSET_MODULE_KEYS, ASSET_MODULE_LABELS } from './constants'
import { AssetModulePanel } from './asset-module-panel'
import { AssetArtifactsPanel } from './asset-artifacts-panel'

const { Text } = Typography

function moduleBadge(job: AssetComparisonJob, moduleKey: AssetModuleKey) {
  const result = job.results.find((item) => item.key === moduleKey)
  if (!result) return <Tag bordered={false}>等待</Tag>
  if (result.status === 'ready') {
    return result.has_diff ? (
      <Tag color="gold" bordered={false}>
        {result.counts ? result.counts.new + result.counts.removed + result.counts.anomaly : '有差异'}
      </Tag>
    ) : (
      <Tag color="success" bordered={false}>
        无差异
      </Tag>
    )
  }
  if (result.status === 'failed') {
    return (
      <Tag color="error" bordered={false}>
        失败
      </Tag>
    )
  }
  return (
    <Tag color="processing" bordered={false}>
      处理中
    </Tag>
  )
}

export function AssetReviewPanel({
  job,
  onUpdated,
}: {
  job: AssetComparisonJob
  onUpdated: () => void
}) {
  const [activeModule, setActiveModule] = useState<AssetModuleKey>('ff')

  return (
    <Flex vertical gap={14}>
      <Card
        variant="outlined"
        title="3. 差异复核"
        extra={<Text type="secondary" style={{ fontSize: 12 }}>按模块查看差异、填写原因并保存复核</Text>}
        styles={{ body: { paddingTop: 4 } }}
      >
        <Tabs
          activeKey={activeModule}
          onChange={(key) => setActiveModule(key as AssetModuleKey)}
          items={ASSET_MODULE_KEYS.map((key) => ({
            key,
            label: (
              <Space size={6}>
                <span>{ASSET_MODULE_LABELS[key]}</span>
                {moduleBadge(job, key)}
              </Space>
            ),
          }))}
        />
        <AssetModulePanel
          key={`${job.jobId}:${activeModule}:${job.annotationRevision}`}
          job={job}
          moduleKey={activeModule}
        />
      </Card>

      <AssetArtifactsPanel job={job} onUpdated={onUpdated} />
    </Flex>
  )
}
