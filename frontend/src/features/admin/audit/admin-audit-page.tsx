import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Flex,
  Input,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../../app/components/page-header'
import { listAuditLogs } from '../../../api/admin'
import type { AuditLogEntry } from '../../../api/admin'
import { parseServerDate } from '../../../lib/date'
import { adminAuditQueryKey } from '../query-keys'
import { actionColor, actionLabel } from './action-labels'

const { Text } = Typography

function formatDate(value: string): string {
  const date = parseServerDate(value)
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : value
}

function prettyDetail(detail: string | null): string {
  if (!detail) return '—'
  try {
    return JSON.stringify(JSON.parse(detail), null, 2)
  } catch {
    return detail
  }
}

export function AdminAuditPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [usernameDraft, setUsernameDraft] = useState('')
  const [actionDraft, setActionDraft] = useState('')
  const [username, setUsername] = useState('')
  const [action, setAction] = useState('')
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  const params = useMemo(
    () => ({
      skip: (page - 1) * pageSize,
      limit: pageSize,
      ...(username ? { username } : {}),
      ...(action ? { action_prefix: action } : {}),
      ...(range?.[0] ? { date_from: range[0].toISOString() } : {}),
      ...(range?.[1] ? { date_to: range[1].toISOString() } : {}),
    }),
    [action, page, pageSize, range, username],
  )

  const auditQuery = useQuery({
    queryKey: adminAuditQueryKey(params),
    queryFn: () => listAuditLogs(params),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })

  const applyFilters = () => {
    setUsername(usernameDraft.trim())
    setAction(actionDraft.trim())
    setPage(1)
  }

  const resetFilters = () => {
    setUsernameDraft('')
    setActionDraft('')
    setUsername('')
    setAction('')
    setRange(null)
    setPage(1)
  }

  const columns: TableProps<AuditLogEntry>['columns'] = [
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      render: (value: string) => (
        <Text type="secondary" className="mono" style={{ fontSize: 11 }}>
          {formatDate(value)}
        </Text>
      ),
    },
    {
      title: '用户',
      dataIndex: 'username',
      width: 120,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 220,
      render: (value: string) => (
        <Space size={6}>
          <Tag color={actionColor(value)} bordered={false}>
            {actionLabel(value)}
          </Tag>
          <Text type="secondary" className="mono" style={{ fontSize: 10 }}>
            {value}
          </Text>
        </Space>
      ),
    },
    {
      title: '目标',
      key: 'target',
      width: 160,
      render: (_, record) =>
        record.target_type ? (
          <Text style={{ fontSize: 12 }}>
            {record.target_type}
            {record.target_id ? ` · ${record.target_id}` : ''}
          </Text>
        ) : (
          '—'
        ),
    },
    {
      title: '来源 IP',
      dataIndex: 'ip_address',
      width: 130,
      render: (value: string | null) => (
        <Text type="secondary" className="mono" style={{ fontSize: 11 }}>
          {value ?? '—'}
        </Text>
      ),
    },
    {
      title: '详情',
      dataIndex: 'detail',
      ellipsis: true,
      render: (value: string | null) => (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {value ? prettyDetail(value).replace(/\s+/g, ' ').slice(0, 100) : '—'}
        </Text>
      ),
    },
  ]

  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="审计日志"
        description="按时间倒序查看系统操作记录，支持用户名、动作与时间范围筛选。"
        eyebrow={
          <Space size={6}>
            <Tag color="blue" bordered={false}>
              {auditQuery.data?.total ?? 0} 条记录
            </Tag>
            <Tag bordered={false}>只读</Tag>
          </Space>
        }
        actions={
          <Button icon={<ReloadOutlined />} onClick={() => void auditQuery.refetch()}>
            刷新
          </Button>
        }
      />

      {auditQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="审计日志加载失败"
          description="请确认当前账号拥有 audit:read 权限。"
        />
      ) : null}

      <Card variant="outlined" styles={{ body: { padding: 18 } }}>
        <Flex wrap gap={10} align="center" style={{ marginBottom: 14 }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="用户名"
            value={usernameDraft}
            onChange={(event) => setUsernameDraft(event.target.value)}
            onPressEnter={applyFilters}
            allowClear
            style={{ width: 180 }}
          />
          <Input
            placeholder="动作前缀，如 tool.asset"
            value={actionDraft}
            onChange={(event) => setActionDraft(event.target.value)}
            onPressEnter={applyFilters}
            allowClear
            style={{ width: 240 }}
          />
          <DatePicker.RangePicker
            showTime
            value={range}
            onChange={(value) => setRange(value as [Dayjs | null, Dayjs | null] | null)}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applyFilters}>
            查询
          </Button>
          <Button onClick={resetFilters}>重置</Button>
        </Flex>

        <Table<AuditLogEntry>
          rowKey="id"
          columns={columns}
          dataSource={auditQuery.data?.items ?? []}
          loading={auditQuery.isFetching}
          size="middle"
          scroll={{ x: 1100 }}
          expandable={{
            expandedRowRender: (record) => (
              <Flex vertical gap={10}>
                <Descriptions
                  size="small"
                  column={2}
                  items={[
                    { key: 'user', label: '用户', children: record.username ?? '—' },
                    { key: 'action', label: '动作', children: record.action },
                    { key: 'target', label: '目标', children: `${record.target_type ?? '—'} / ${record.target_id ?? '—'}` },
                    { key: 'ip', label: 'IP', children: record.ip_address ?? '—' },
                  ]}
                />
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    borderRadius: 8,
                    background: 'rgba(127, 127, 127, 0.08)',
                    fontSize: 11,
                    overflow: 'auto',
                    maxHeight: 260,
                  }}
                >
                  {prettyDetail(record.detail)}
                </pre>
              </Flex>
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total: auditQuery.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage)
              setPageSize(nextSize)
            },
          }}
        />
      </Card>
    </Flex>
  )
}
