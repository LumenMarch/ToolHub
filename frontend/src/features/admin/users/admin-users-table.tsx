import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Space,
  Table,
  Tag,
  theme,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import type { AdminUser } from '../../../api/admin'
import { parseServerDate } from '../../../lib/date'

const { Text } = Typography

const STATUS_META = {
  pending: { label: '待审批', color: 'gold' },
  approved: { label: '已通过', color: 'green' },
  rejected: { label: '已拒绝', color: 'red' },
} as const

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = parseServerDate(value)
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : '—'
}

interface AdminUsersTableProps {
  users: AdminUser[]
  total: number
  loading: boolean
  page: number
  pageSize: number
  currentUserId?: number
  canWriteUsers: boolean
  onPageChange: (page: number, pageSize: number) => void
  onEdit: (user: AdminUser) => void
  onApprove: (user: AdminUser) => void
  onReject: (user: AdminUser) => void
  onDelete: (user: AdminUser) => void
  onSessions: (user: AdminUser) => void
}

export function AdminUsersTable({
  users,
  total,
  loading,
  page,
  pageSize,
  currentUserId,
  canWriteUsers,
  onPageChange,
  onEdit,
  onApprove,
  onReject,
  onDelete,
  onSessions,
}: AdminUsersTableProps) {
  const { token } = theme.useToken()

  const columns: TableProps<AdminUser>['columns'] = [
    {
      title: '用户',
      key: 'user',
      width: 210,
      render: (_, user) => (
        <Space size={10}>
          <Avatar
            style={{
              background:
                user.status === 'pending' ? token.colorWarningBg : 'rgba(79, 70, 229, 0.12)',
              color: user.status === 'pending' ? token.colorWarning : token.colorPrimary,
              fontWeight: 600,
            }}
          >
            {user.username.slice(0, 1).toUpperCase()}
          </Avatar>
          <div style={{ minWidth: 0 }}>
            <Text strong style={{ display: 'block', fontSize: 13 }}>
              {user.username}
            </Text>
            <Text type="secondary" className="mono" style={{ fontSize: 10 }}>
              id {user.id}
            </Text>
          </div>
        </Space>
      ),
    },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 220,
      render: (roles: string[]) =>
        roles.length > 0 ? (
          <Space size={4} wrap>
            {roles.map((role) => (
              <Tag key={role} bordered={false} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                {role}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '审批状态',
      dataIndex: 'status',
      width: 110,
      render: (status: AdminUser['status']) => (
        <Tag color={STATUS_META[status].color} bordered={false}>
          {STATUS_META[status].label}
        </Tag>
      ),
    },
    {
      title: '在线',
      dataIndex: 'online',
      width: 90,
      render: (online: boolean) => (
        <Badge
          status={online ? 'success' : 'default'}
          text={<span style={{ fontSize: 12 }}>{online ? '在线' : '离线'}</span>}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 150,
      render: (value: string) => (
        <Text type="secondary" className="mono" style={{ fontSize: 11 }}>
          {formatDate(value)}
        </Text>
      ),
    },
    {
      title: '最近登录',
      dataIndex: 'last_login_at',
      width: 150,
      render: (value: string | null) => (
        <Text type="secondary" className="mono" style={{ fontSize: 11 }}>
          {formatDate(value)}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 190,
      fixed: 'right',
      render: (_, user) => {
        const isSelf = currentUserId === user.id
        return (
          <Space size={0} wrap>
            {canWriteUsers && user.status === 'pending' ? (
              <>
                <Button type="link" size="small" onClick={() => onApprove(user)}>
                  通过
                </Button>
                <Button type="link" size="small" danger onClick={() => onReject(user)}>
                  拒绝
                </Button>
              </>
            ) : null}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  ...(canWriteUsers ? [{ key: 'edit', label: '编辑用户' }] : []),
                  { key: 'sessions', label: '登录会话' },
                  ...(canWriteUsers
                    ? [
                        { type: 'divider' as const },
                        { key: 'delete', label: '删除用户', danger: true, disabled: isSelf },
                      ]
                    : []),
                ],
                onClick: ({ key }) => {
                  if (key === 'edit') onEdit(user)
                  if (key === 'sessions') onSessions(user)
                  if (key === 'delete') onDelete(user)
                },
              }}
            >
              <Button type="link" size="small">
                更多 <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  return (
    <Table<AdminUser>
      rowKey="id"
      columns={columns}
      dataSource={users}
      loading={loading}
      size="middle"
      scroll={{ x: 1120 }}
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        showTotal: (count) => `共 ${count} 条`,
        onChange: onPageChange,
      }}
    />
  )
}
