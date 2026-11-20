import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Progress,
  Row,
  Segmented,
  Space,
  Tag,
  theme,
  Typography,
} from 'antd'
import {
  AuditOutlined,
  ReloadOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../../app/components/page-header'
import { MetricCard } from '../../../app/components/metric-card'
import { getDailyActive, getOverview, getToolCalls } from '../../../api/admin'
import {
  adminDailyActiveQueryKey,
  adminOverviewQueryKey,
  adminToolCallsQueryKey,
} from '../query-keys'
import { ActiveChart } from './active-chart'

const { Text } = Typography

const TOOL_LABELS: Array<[string, string]> = [
  ['tool.asset', '资产核对'],
  ['tool.qrcode', '二维码生成'],
  ['tool.attendance', '出勤资料整理'],
  ['tool.atlas_merge', 'AtlasLog Merge'],
  ['tool.cpk_charts', 'OPP / CPK'],
  ['tool.box_plot', '箱线图'],
  ['tool.tt_time', '测试时间分析'],
  ['tool.retest_rate', '重测率统计'],
  ['tool.meta', '工具目录'],
  ['tool.image_to_pdf', '图片转 PDF'],
]

function resolveToolLabel(action: string): string {
  const matched = TOOL_LABELS.find(([prefix]) => action.startsWith(prefix))
  if (matched) return matched[1]
  return action.startsWith('tool.') ? action.split('.').slice(0, 2).join('.') : '其它操作'
}

export function AdminOverviewPage() {
  const { token } = theme.useToken()
  const [days, setDays] = useState(14)

  const overviewQuery = useQuery({
    queryKey: adminOverviewQueryKey,
    queryFn: getOverview,
    staleTime: 60_000,
  })
  const activeQuery = useQuery({
    queryKey: adminDailyActiveQueryKey(days),
    queryFn: () => getDailyActive(days),
    staleTime: 60_000,
  })
  const toolCallsQuery = useQuery({
    queryKey: adminToolCallsQueryKey(days),
    queryFn: () => getToolCalls(days),
    staleTime: 60_000,
  })

  const ranking = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of toolCallsQuery.data ?? []) {
      const label = resolveToolLabel(row.action)
      totals.set(label, (totals.get(label) ?? 0) + row.count)
    }
    const rows = [...totals.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count)
    const max = rows[0]?.count ?? 1
    return rows.slice(0, 7).map((row) => ({
      ...row,
      percent: Math.max(1, Math.round((row.count / max) * 100)),
    }))
  }, [toolCallsQuery.data])

  const error =
    overviewQuery.error ?? activeQuery.error ?? toolCallsQuery.error ?? null

  return (
    <Flex vertical gap={20}>
      <PageHeader
        title="管理概览"
        description="用户活跃、工具调用与审计概况。统计基于审计日志。"
        eyebrow={
          <Space size={6}>
            <Tag color="purple" bordered={false}>
              管理员视图
            </Tag>
            <Tag bordered={false}>最近 {days} 天</Tag>
          </Space>
        }
        actions={
          <Space>
            <Segmented
              value={`${days} 天`}
              onChange={(value) => setDays(Number(String(value).replace(' 天', '')))}
              options={['7 天', '14 天', '30 天']}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void overviewQuery.refetch()
                void activeQuery.refetch()
                void toolCallsQuery.refetch()
              }}
            >
              刷新
            </Button>
          </Space>
        }
      />

      {error ? (
        <Alert
          type="error"
          showIcon
          message="统计数据加载失败"
          description="请确认后端服务可用，并检查当前账号是否有 stats:read 权限。"
        />
      ) : null}

      <Row gutter={[14, 14]}>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="总用户"
            value={overviewQuery.data?.total_users ?? 0}
            icon={<TeamOutlined />}
            accent="#4f46e5"
            hint="全部注册账号"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="7 日活跃"
            value={overviewQuery.data?.active_users_7d ?? 0}
            icon={<UserOutlined />}
            accent="#0ea5e9"
            hint="近 7 天登录过"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="工具数"
            value={overviewQuery.data?.total_tools ?? 0}
            icon={<ThunderboltOutlined />}
            accent="#10b981"
            hint="工具目录条目"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="今日审计"
            value={overviewQuery.data?.audit_logs_today ?? 0}
            icon={<AuditOutlined />}
            accent="#f59e0b"
            hint="今日新增审计事件"
          />
        </Col>
      </Row>

      <Row gutter={[14, 14]}>
        <Col xs={24} xl={16}>
          <Card
            variant="outlined"
            title="每日活跃用户"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>最近 {days} 天</Text>}
            styles={{ body: { padding: '8px 18px 10px' } }}
            loading={activeQuery.isPending}
          >
            {activeQuery.data?.length ? (
              <ActiveChart data={activeQuery.data} height={300} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无活跃数据" />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card
            variant="outlined"
            title="工具调用排行"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>按动作聚合</Text>}
            styles={{ body: { padding: '16px 18px 8px' } }}
            loading={toolCallsQuery.isPending}
            style={{ height: '100%' }}
          >
            {ranking.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用记录" />
            ) : (
              <Flex vertical gap={14}>
                {ranking.map((row, index) => (
                  <div key={row.name}>
                    <Flex justify="space-between" align="center" style={{ marginBottom: 4 }}>
                      <Space size={8}>
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            display: 'grid',
                            placeItems: 'center',
                            background:
                              index === 0 ? 'rgba(79, 70, 229, 0.12)' : token.colorFillQuaternary,
                            color: index === 0 ? token.colorPrimary : token.colorTextTertiary,
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          {index + 1}
                        </span>
                        <Text style={{ fontSize: 12 }}>{row.name}</Text>
                      </Space>
                      <Text type="secondary" className="mono" style={{ fontSize: 11 }}>
                        {row.count.toLocaleString('zh-CN')}
                      </Text>
                    </Flex>
                    <Progress
                      percent={row.percent}
                      size="small"
                      showInfo={false}
                      strokeColor={index === 0 ? token.colorPrimary : token.colorPrimaryBorder}
                      trailColor={token.colorFillQuaternary}
                      style={{ margin: 0 }}
                    />
                  </div>
                ))}
              </Flex>
            )}
          </Card>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        message="统计口径"
        description="用户数与活跃数来自用户表；工具调用与每日活跃来自审计日志。跨工具动作按前缀聚合，未知动作保留原始前缀。"
      />
    </Flex>
  )
}
