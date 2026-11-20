import { Alert, Flex, Tabs, Tag } from 'antd'
import { PageHeader } from '../../../app/components/page-header'
import { LlmConfigPanel } from './llm-config-panel'
import { LlmStatusPanel } from './llm-status-panel'

export function AdminLlmPage() {
  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="模型服务"
        description="查看运行时健康、队列、缓存与指标，并管理 env 之上的覆盖配置。"
        eyebrow={
          <Tag color="purple" bordered={false}>
            全局生效 · 修改无需重启
          </Tag>
        }
      />
      <Alert
        type="info"
        showIcon
        message="配置变更会影响所有使用模型服务的工具"
        description="保存后立即生效；远程服务地址必须使用 HTTPS，内网地址需由运维加入 LLM_ALLOWED_HOSTS。"
      />
      <Tabs
        defaultActiveKey="status"
        items={[
          {
            key: 'status',
            label: '运行状态',
            children: <LlmStatusPanel />,
          },
          {
            key: 'config',
            label: '运行时配置',
            children: <LlmConfigPanel />,
          },
        ]}
      />
    </Flex>
  )
}
