import { useMemo, useState } from 'react'
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  Row,
  Segmented,
  Space,
  Tag,
  theme,
  Typography,
} from 'antd'
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  KeyOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../app/components/page-header'
import { MetricCard } from '../../app/components/metric-card'
import { useAuth } from '../auth/auth-context'
import { usePermission } from '../auth/use-permission'
import { useVisibleTools } from './use-visible-tools'
import type { VisibleTool } from './use-visible-tools'

const { Title, Text } = Typography

type CategoryFilter = '全部' | '数据处理' | '质量分析' | '文件工具'

function ToolCard({ tool, onOpen }: { tool: VisibleTool; onOpen: () => void }) {
  const { token } = theme.useToken()

  return (
    <Card
      className="tool-card"
      hoverable
      variant="outlined"
      onClick={onOpen}
      styles={{ body: { padding: 18, height: '100%' } }}
      style={{ height: '100%' }}
    >
      <Flex vertical gap={14} style={{ height: '100%' }}>
        <Flex justify="space-between" align="flex-start">
          <div
            className="tool-icon"
            style={{ background: `${tool.accent}16`, color: tool.accent }}
          >
            <tool.icon />
          </div>
          <Space size={4}>
            <Tag bordered={false} style={{ marginInlineEnd: 0, fontSize: 11 }}>
              {tool.category}
            </Tag>
            {tool.status === 'migrating' ? (
              <Tag color="processing" bordered={false} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                重构中
              </Tag>
            ) : null}
          </Space>
        </Flex>
        <div style={{ flex: 1 }}>
          <Text strong style={{ fontSize: 15, display: 'block' }}>
            {tool.name}
          </Text>
          <Text
            type="secondary"
            style={{ fontSize: 12, lineHeight: 1.6, display: 'block', marginTop: 6 }}
          >
            {tool.description}
          </Text>
        </div>
        <Flex align="center" gap={6} style={{ color: token.colorPrimary, fontSize: 12 }}>
          打开工具 <ArrowRightOutlined />
        </Flex>
      </Flex>
    </Card>
  )
}

export function DashboardPage() {
  const { token } = theme.useToken()
  const { user } = useAuth()
  const { isAdmin, permissions } = usePermission()
  const { tools, isLoading, isError, refetch } = useVisibleTools()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('全部')

  const filteredTools = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return tools.filter((tool) => {
      const matchesQuery =
        !keyword ||
        tool.name.toLowerCase().includes(keyword) ||
        tool.description.toLowerCase().includes(keyword) ||
        tool.category.includes(keyword)
      const matchesCategory = category === '全部' || tool.category === category
      return matchesQuery && matchesCategory
    })
  }, [category, query, tools])

  const directPermissions = user?.direct_tool_permissions?.length ?? 0

  return (
    <Flex vertical gap={20}>
      <PageHeader
        title="工作台"
        description={`欢迎回来，${user?.username ?? '用户'}。选择一个工具开始工作。`}
        actions={
          <Space>
            <Button onClick={() => void refetch()}>刷新</Button>
            {isAdmin ? (
              <Button
                type="primary"
                icon={<SettingOutlined />}
                onClick={() => navigate('/admin')}
              >
                管理控制台
              </Button>
            ) : null}
          </Space>
        }
        eyebrow={
          <Space size={6}>
            <Tag color="success" bordered={false}>
              账号正常
            </Tag>
            <Tag bordered={false}>{tools.length} 个可用工具</Tag>
          </Space>
        }
      />

      <Row gutter={[14, 14]}>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="可用工具"
            value={tools.length}
            icon={<AppstoreOutlined />}
            accent="#4f46e5"
            hint={isLoading ? '正在同步权限' : '按当前权限过滤'}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="角色"
            value={user?.roles.length ?? 0}
            icon={<TeamOutlined />}
            accent="#0ea5e9"
            hint={user?.roles.join(' · ') || '未分配角色'}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="权限项"
            value={permissions.length}
            icon={<SafetyCertificateOutlined />}
            accent="#10b981"
            hint="包含角色与直接授权"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard
            label="直接工具权限"
            value={directPermissions}
            icon={<KeyOutlined />}
            accent="#f59e0b"
            hint="角色之外的单用户授权"
          />
        </Col>
      </Row>

      {isError ? (
        <Alert
          type="warning"
          showIcon
          message="工具元数据加载失败"
          description="当前仅按静态权限显示工具；启用/禁用和自定义排序可能未生效。"
        />
      ) : null}

      <Row gutter={[14, 14]}>
        <Col xs={24} xl={18}>
          <Card
            variant="outlined"
            title={
              <Flex align="center" gap={10}>
                <span>全部工具</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                  {filteredTools.length} / {tools.length}
                </Text>
              </Flex>
            }
          >
            <Flex vertical gap={16}>
              <Flex justify="space-between" align="center" wrap gap={10}>
                <Input
                  prefix={<SearchOutlined />}
                  placeholder="搜索工具名称或描述"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  allowClear
                  style={{ maxWidth: 360, flex: '1 1 220px' }}
                />
                <Segmented
                  size="small"
                  value={category}
                  onChange={(value) => setCategory(value as CategoryFilter)}
                  options={['全部', '数据处理', '质量分析', '文件工具']}
                />
              </Flex>
              {isLoading ? (
                <Flex justify="center" style={{ padding: 48 }}>
                  <Text type="secondary">正在加载工具…</Text>
                </Flex>
              ) : filteredTools.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    tools.length === 0
                      ? '当前账号没有可用工具，请联系管理员分配权限。'
                      : '没有匹配的工具'
                  }
                >
                  <Button
                    onClick={() => {
                      setQuery('')
                      setCategory('全部')
                    }}
                  >
                    清空筛选
                  </Button>
                </Empty>
              ) : (
                <Row gutter={[14, 14]}>
                  {filteredTools.map((tool) => (
                    <Col key={tool.id} xs={24} sm={12} lg={8}>
                      <ToolCard tool={tool} onOpen={() => navigate(tool.path)} />
                    </Col>
                  ))}
                </Row>
              )}
            </Flex>
          </Card>
        </Col>

        <Col xs={24} xl={6}>
          <Card
            variant="outlined"
            title="账号与权限"
            style={{ height: '100%' }}
            styles={{ body: { padding: 20 } }}
          >
            <Flex vertical align="center" gap={10} style={{ textAlign: 'center' }}>
              <Avatar
                size={64}
                style={{
                  background: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
                  fontSize: 24,
                  fontWeight: 600,
                }}
              >
                {user?.username.slice(0, 1).toUpperCase()}
              </Avatar>
              <div>
                <Title level={5} style={{ margin: 0 }}>
                  {user?.username}
                </Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {user?.roles.length ? user.roles.join(' · ') : '未分配角色'}
                </Text>
              </div>
              <Space size={4} wrap style={{ justifyContent: 'center' }}>
                <Tag color="success" bordered={false}>
                  已通过审批
                </Tag>
                {isAdmin ? (
                  <Tag color="purple" bordered={false}>
                    管理员
                  </Tag>
                ) : null}
              </Space>
            </Flex>

            <div
              style={{
                marginTop: 18,
                padding: '12px 14px',
                borderRadius: 10,
                background: token.colorFillQuaternary,
              }}
            >
              <Flex justify="space-between">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  权限项
                </Text>
                <Text strong>{permissions.length}</Text>
              </Flex>
              <Flex justify="space-between" style={{ marginTop: 6 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  可用工具
                </Text>
                <Text strong>{tools.length}</Text>
              </Flex>
              <Flex justify="space-between" style={{ marginTop: 6 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  直接授权
                </Text>
                <Text strong>{directPermissions}</Text>
              </Flex>
            </div>

            {isAdmin ? (
              <Button
                block
                style={{ marginTop: 16 }}
                icon={<SettingOutlined />}
                onClick={() => navigate('/admin')}
              >
                进入管理控制台
              </Button>
            ) : null}
          </Card>
        </Col>
      </Row>
    </Flex>
  )
}
