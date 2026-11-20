import { useState } from 'react'
import type { ComponentType } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Input,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../../app/components/page-header'
import { bulkUpdateAdminToolMetas, listAdminToolMetas } from '../../../api/admin'
import type { AdminToolMeta } from '../../../api/admin'
import { readApiErrorMessage } from '../../../api/errors'
import { TOOL_CATALOG } from '../../dashboard/tool-catalog'
import { toolsMetaQueryKey } from '../../dashboard/use-visible-tools'
import { usePermission } from '../../auth/use-permission'
import { adminToolsQueryKey } from '../query-keys'

const { Text } = Typography

interface ToolRow {
  tool_id: string
  name: string
  description: string
  icon: ComponentType
  enabled: boolean
  sort_order: number
  custom_name: string
  custom_description: string
}

function buildRows(metas: AdminToolMeta[]): ToolRow[] {
  const metaByTool = new Map(metas.map((meta) => [meta.tool_id, meta]))
  return TOOL_CATALOG.map((tool, index) => {
    const meta = metaByTool.get(tool.id)
    return {
      tool_id: tool.id,
      name: tool.name,
      description: tool.description,
      icon: tool.icon,
      enabled: meta?.enabled ?? true,
      sort_order: meta?.sort_order ?? index,
      custom_name: meta?.custom_name ?? '',
      custom_description: meta?.custom_description ?? '',
    }
  }).sort((left, right) => left.sort_order - right.sort_order)
}

function ToolsEditor({ metas }: { metas: AdminToolMeta[] }) {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const { has } = usePermission()
  const canWrite = has('tool_meta:write')
  const [rows, setRows] = useState<ToolRow[]>(() => buildRows(metas))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const updateRow = (toolId: string, patch: Partial<ToolRow>) => {
    setRows((previous) =>
      previous.map((row) => (row.tool_id === toolId ? { ...row, ...patch } : row)),
    )
    setDirty(true)
  }

  const moveRow = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    setRows((previous) => {
      const next = [...previous]
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return next.map((item, order) => ({ ...item, sort_order: order }))
    })
    setDirty(true)
  }

  const restoreDefault = (toolId: string) => {
    updateRow(toolId, { enabled: true, custom_name: '', custom_description: '' })
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await bulkUpdateAdminToolMetas(
        rows.map((row, index) => ({
          tool_id: row.tool_id,
          enabled: row.enabled,
          sort_order: index,
          custom_name: row.custom_name.trim() || null,
          custom_description: row.custom_description.trim() || null,
        })),
      )
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: adminToolsQueryKey })
      void queryClient.invalidateQueries({ queryKey: toolsMetaQueryKey })
      message.success('工具目录已保存')
    } catch (saveError) {
      setError(readApiErrorMessage(saveError) ?? '保存失败，请稍后重试。')
    } finally {
      setSaving(false)
    }
  }

  const columns: TableProps<ToolRow>['columns'] = [
    {
      title: '工具',
      key: 'tool',
      width: 240,
      render: (_, row) => {
        const Icon = row.icon
        return (
          <Space size={10}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(79, 70, 229, 0.10)',
                color: '#4f46e5',
              }}
            >
              <Icon />
            </div>
            <div style={{ minWidth: 0 }}>
              <Text strong style={{ display: 'block', fontSize: 13 }}>
                {row.name}
              </Text>
              <Text type="secondary" className="mono" style={{ fontSize: 10 }}>
                {row.tool_id}
              </Text>
            </div>
          </Space>
        )
      },
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (enabled: boolean, row) => (
        <Switch
          size="small"
          checked={enabled}
          disabled={!canWrite}
          onChange={(checked) => updateRow(row.tool_id, { enabled: checked })}
        />
      ),
    },
    {
      title: '自定义名称',
      dataIndex: 'custom_name',
      width: 180,
      render: (value: string, row) => (
        <Input
          size="small"
          value={value}
          placeholder={row.name}
          disabled={!canWrite}
          onChange={(event) => updateRow(row.tool_id, { custom_name: event.target.value })}
        />
      ),
    },
    {
      title: '自定义描述',
      dataIndex: 'custom_description',
      render: (value: string, row) => (
        <Input
          size="small"
          value={value}
          placeholder={row.description}
          disabled={!canWrite}
          onChange={(event) =>
            updateRow(row.tool_id, { custom_description: event.target.value })
          }
        />
      ),
    },
    {
      title: '排序',
      key: 'sort',
      width: 110,
      render: (_, _row, index) => (
        <Space size={0}>
          <Button
            type="text"
            size="small"
            aria-label="上移"
            icon={<ArrowUpOutlined />}
            disabled={!canWrite || index === 0}
            onClick={() => moveRow(index, -1)}
          />
          <Button
            type="text"
            size="small"
            aria-label="下移"
            icon={<ArrowDownOutlined />}
            disabled={!canWrite || index === rows.length - 1}
            onClick={() => moveRow(index, 1)}
          />
          <Text type="secondary" className="mono" style={{ fontSize: 10 }}>
            {index + 1}
          </Text>
        </Space>
      ),
    },
    {
      title: '状态',
      key: 'state',
      width: 100,
      render: (_, row) =>
        row.custom_name.trim() || row.custom_description.trim() ? (
          <Tag color="blue" bordered={false}>
            自定义
          </Tag>
        ) : (
          <Tag bordered={false}>默认</Tag>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          disabled={!canWrite || (!row.custom_name && !row.custom_description && row.enabled)}
          onClick={() => restoreDefault(row.tool_id)}
        >
          恢复默认
        </Button>
      ),
    },
  ]

  return (
    <Flex vertical gap={14}>
      {error ? (
        <Alert type="error" showIcon closable message={error} onClose={() => setError('')} />
      ) : null}
      <Alert
        type="info"
        showIcon
        message="工具目录是静态定义的覆盖层"
        description="名称、描述、启用状态和排序会写入数据库；前端静态配置仍是工具代码的唯一来源。"
      />
      <Card
        variant="outlined"
        styles={{ body: { padding: 18 } }}
        extra={
          <Space>
            {dirty ? (
              <Tag color="warning" bordered={false}>
                有未保存修改
              </Tag>
            ) : null}
            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={!canWrite || !dirty}
              loading={saving}
              onClick={() => void handleSave()}
            >
              保存全部
            </Button>
          </Space>
        }
        title="工具条目"
      >
        <Table<ToolRow>
          rowKey="tool_id"
          columns={columns}
          dataSource={rows}
          pagination={false}
          size="middle"
          scroll={{ x: 1120 }}
        />
      </Card>
    </Flex>
  )
}

export function AdminToolsPage() {
  const query = useQuery({
    queryKey: adminToolsQueryKey,
    queryFn: listAdminToolMetas,
    staleTime: 30_000,
  })

  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="工具目录"
        description="控制工作台可见工具、自定义名称描述和展示顺序。"
        actions={
          <Button icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
            刷新
          </Button>
        }
      />
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message="工具元数据加载失败"
          description="请确认当前账号拥有 tool_meta:read 权限。"
        />
      ) : null}
      {query.isPending ? (
        <Card variant="outlined" loading />
      ) : query.data ? (
        <ToolsEditor metas={query.data} />
      ) : null}
    </Flex>
  )
}
