import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Progress,
  Row,
  Space,
  Tag,
  theme,
  Typography,
} from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ReloadOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getLlmStatus, probeLlm } from '../../../api/admin'
import { MetricCard } from '../../../app/components/metric-card'
import { usePermission } from '../../auth/use-permission'
import { adminLlmStatusQueryKey } from '../query-keys'

const { Text } = Typography

export function LlmStatusPanel() {
  const { token } = theme.useToken()
  const { has } = usePermission()
  const canWrite = has('llm_config:write')
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: adminLlmStatusQueryKey,
    queryFn: () => getLlmStatus(false),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const probeMutation = useMutation({
    mutationFn: probeLlm,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminLlmStatusQueryKey })
    },
  })

  const status = statusQuery.data
  const probe = probeMutation.data

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={10}>
        <Space wrap>
          <Tag color={status?.enabled ? 'green' : 'default'} bordered={false}>
            开关 {status?.enabled ? '启用' : '关闭'}
          </Tag>
          <Tag color={status?.configured ? 'green' : 'orange'} bordered={false}>
            配置 {status?.configured ? '完整' : '缺失'}
          </Tag>
          <Tag color={status?.available ? 'green' : 'red'} bordered={false}>
            可用性 {status?.available ? '可用' : '不可用'}
          </Tag>
          {status?.cooldownActive ? (
            <Tag color="red" bordered={false}>
              冷却中
            </Tag>
          ) : null}
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void statusQuery.refetch()}>
            刷新
          </Button>
          {canWrite ? (
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={probeMutation.isPending}
              onClick={() => probeMutation.mutate()}
            >
              测试连接
            </Button>
          ) : null}
        </Space>
      </Flex>

      {status?.lastError ? (
        <Alert
          type="error"
          showIcon
          message="最近一次调用错误"
          description={status.lastError}
        />
      ) : null}

      {probe ? (
        <Alert
          type={probe.ok ? 'success' : 'error'}
          showIcon
          icon={probe.ok ? <CheckCircleFilled /> : <CloseCircleFilled />}
          message={probe.ok ? '探活成功' : '探活失败'}
          description={
            <Flex vertical gap={6}>
              <Text>{probe.error ?? `可访问，返回 ${probe.models.length} 个模型。`}</Text>
              {probe.models.length ? (
                <Space wrap size={4}>
                  {probe.models.map((model) => (
                    <Tag key={model} bordered={false} className="mono" style={{ fontSize: 10 }}>
                      {model}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </Flex>
          }
        />
      ) : null}

      {statusQuery.isError ? (
        <Alert type="error" showIcon message="模型服务状态加载失败" />
      ) : null}

      <Row gutter={[14, 14]}>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="请求数"
            value={status?.metrics.requests ?? 0}
            icon={<ThunderboltOutlined />}
            accent="#4f46e5"
            hint={`成功 ${status?.metrics.ok ?? 0} · 缓存 ${status?.metrics.cached ?? 0}`}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="错误率"
            value={status?.metrics.errorPercent ?? 0}
            suffix="%"
            icon={<WarningOutlined />}
            accent="#ef4444"
            hint={`错误 ${status?.metrics.errors ?? 0} · 拒绝 ${status?.metrics.rejections ?? 0}`}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="P95 延迟"
            value={((status?.metrics.p95LatencyMs ?? 0) / 1000).toFixed(1)}
            suffix="s"
            icon={<ReloadOutlined />}
            accent="#f59e0b"
            hint={`P50 ${((status?.metrics.p50LatencyMs ?? 0) / 1000).toFixed(1)}s`}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="缓存命中率"
            value={status?.cache.hitPercent ?? 0}
            suffix="%"
            icon={<CheckCircleFilled />}
            accent="#10b981"
            hint={`${status?.cache.entries ?? 0} / ${status?.cache.capacity ?? 0} 条`}
          />
        </Col>
      </Row>

      <Card variant="outlined" title="运行状态" loading={statusQuery.isPending}>
        {status ? (
          <Flex vertical gap={18}>
            <Descriptions
              column={{ xs: 1, md: 2 }}
              size="small"
              items={[
                { key: 'provider', label: '协议', children: status.provider },
                { key: 'model', label: '模型', children: <span className="mono">{status.model || '—'}</span> },
                { key: 'source', label: '配置来源', children: status.source === 'db' ? '数据库覆盖' : 'env 默认' },
                { key: 'modelListed', label: '模型在服务端列表', children: status.modelListed === null ? '未探测' : status.modelListed ? '是' : '否' },
                { key: 'apiKey', label: '密钥', children: status.apiKeySet ? status.apiKeyMask : '未设置' },
                { key: 'uptime', label: '运行时长', children: `${Math.floor(status.metrics.uptimeSeconds / 60)} 分钟` },
                { key: 'providers', label: '支持协议', children: <Space wrap size={4}>{status.supportedProviders.map((item) => <Tag key={item} bordered={false}>{item}</Tag>)}</Space> },
                { key: 'baseUrl', label: '服务地址', children: <span className="mono">{status.baseUrl || '—'}</span> },
              ]}
            />

            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  并发闸门
                </Text>
                <Flex justify="space-between" style={{ marginTop: 4 }}>
                  <Text className="mono">
                    {status.gate.inflight} / {status.gate.capacity}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    在途 / 容量
                  </Text>
                </Flex>
                <Progress
                  percent={Math.min(100, Math.round((status.gate.inflight / Math.max(status.gate.capacity, 1)) * 100))}
                  size="small"
                  strokeColor={token.colorPrimary}
                  showInfo={false}
                />
                <Flex justify="space-between" style={{ marginTop: 8 }}>
                  <Text className="mono">
                    {status.gate.queued} / {status.gate.maxQueued}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    排队 / 上限
                  </Text>
                </Flex>
              </Col>
              <Col xs={24} md={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  缓存
                </Text>
                <Descriptions
                  column={1}
                  size="small"
                  items={[
                    { key: 'entries', label: '条目', children: `${status.cache.entries} / ${status.cache.capacity}` },
                    { key: 'ttl', label: 'TTL', children: `${status.cache.ttlSeconds} 秒` },
                    { key: 'hits', label: '命中 / 未命中', children: `${status.cache.hits} / ${status.cache.misses}` },
                  ]}
                />
              </Col>
            </Row>

            {Object.keys(status.metrics.errorCodes).length ? (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  错误分布
                </Text>
                <Space wrap size={4} style={{ marginTop: 4 }}>
                  {Object.entries(status.metrics.errorCodes).map(([code, count]) => (
                    <Tag key={code} color="red" bordered={false} className="mono">
                      {code} × {count}
                    </Tag>
                  ))}
                </Space>
              </div>
            ) : null}
          </Flex>
        ) : null}
      </Card>
    </Flex>
  )
}
