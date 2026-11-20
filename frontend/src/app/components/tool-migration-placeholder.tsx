import { Button, Card, Result, Space, Tag, theme, Typography } from 'antd'
import { ArrowLeftOutlined, ExperimentOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ToolDefinition } from '../../features/dashboard/tool-catalog'

const { Text } = Typography

interface ToolMigrationPlaceholderProps {
  tool: ToolDefinition
}

export function ToolMigrationPlaceholder({ tool }: ToolMigrationPlaceholderProps) {
  const navigate = useNavigate()
  const { token } = theme.useToken()

  return (
    <Card variant="outlined" styles={{ body: { padding: 32 } }}>
      <Result
        icon={<ExperimentOutlined style={{ color: token.colorPrimary }} />}
        title={`${tool.name} · 重构中`}
        subTitle={
          <Space direction="vertical" size={6}>
            <Text type="secondary">{tool.description}</Text>
            <Space>
              <Tag bordered={false}>{tool.category}</Tag>
              <Tag color="processing" bordered={false}>
                正在迁移到 Ant Design
              </Tag>
            </Space>
          </Space>
        }
        extra={
          <Button type="primary" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
            返回工作台
          </Button>
        }
      />
    </Card>
  )
}
