import { useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Input,
  Select,
  Space,
  Tag,
  theme,
  Typography,
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../../app/components/page-header'
import {
  deleteAdminUser,
  listAdminUsers,
  listPermissions,
  listRoles,
  rejectAdminUser,
} from '../../../api/admin'
import type { AdminUser } from '../../../api/admin'
import { readApiErrorMessage } from '../../../api/errors'
import { useAuth } from '../../auth/auth-context'
import { usePermission } from '../../auth/use-permission'
import { usePendingApprovalCount } from '../use-pending-count'
import { adminUsersQueryKey } from '../query-keys'
import { ApproveUserModal } from './approve-user-modal'
import { UserEditorModal } from './user-editor-modal'
import { UserSessionsDrawer } from './user-sessions-drawer'
import { AdminUsersTable } from './admin-users-table'

const { Text } = Typography

const STATUS_OPTIONS = [
  { label: '待审批', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
]

export function AdminUsersPage() {
  const { token } = theme.useToken()
  const { message, modal } = AntApp.useApp()
  const { user: currentUser } = useAuth()
  const { has } = usePermission()
  const queryClient = useQueryClient()
  const pendingCount = usePendingApprovalCount()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; user?: AdminUser } | null>(null)
  const [approveUser, setApproveUser] = useState<AdminUser | null>(null)
  const [sessionsUser, setSessionsUser] = useState<AdminUser | null>(null)

  const canReadRoles = has('role:read')
  const canWriteUsers = has('user:write')

  const rolesQuery = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: listRoles,
    enabled: canReadRoles,
    staleTime: 60_000,
  })
  const permissionsQuery = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: listPermissions,
    enabled: canReadRoles,
    staleTime: 60_000,
  })

  const params = useMemo(
    () => ({
      skip: (page - 1) * pageSize,
      limit: pageSize,
      ...(search ? { search } : {}),
      ...(statusFilter.length ? { status: statusFilter.join(',') } : {}),
    }),
    [page, pageSize, search, statusFilter],
  )

  const usersQuery = useQuery({
    queryKey: adminUsersQueryKey(params),
    queryFn: () => listAdminUsers(params),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })

  const canEditRoles = canReadRoles && !rolesQuery.isError && !permissionsQuery.isError

  const invalidateUsers = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }

  const handleReject = (user: AdminUser) => {
    modal.confirm({
      title: '拒绝注册申请',
      content: `确定拒绝 ${user.username} 的注册申请吗？该用户会收到通知，旧会话会被吊销。`,
      okText: '拒绝申请',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await rejectAdminUser(user.id)
          message.success('已拒绝注册申请')
          invalidateUsers()
        } catch (error) {
          message.error(readApiErrorMessage(error) ?? '操作失败')
          throw error
        }
      },
    })
  }

  const handleDelete = (user: AdminUser) => {
    modal.confirm({
      title: '删除用户',
      content: `确定删除 ${user.username} 吗？该操作不可回滚，用户的所有会话会失效。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteAdminUser(user.id)
          message.success('用户已删除')
          invalidateUsers()
        } catch (error) {
          message.error(readApiErrorMessage(error) ?? '删除失败')
          throw error
        }
      },
    })
  }

  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="用户管理"
        description="管理系统账号、审批状态、角色与直接工具权限。"
        eyebrow={
          <Space size={6}>
            <Tag color="gold" bordered={false}>
              {pendingCount} 待审批
            </Tag>
            <Tag bordered={false}>{usersQuery.data?.total ?? 0} 个账号</Tag>
          </Space>
        }
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void usersQuery.refetch()}>
              刷新
            </Button>
            {canWriteUsers ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ mode: 'create' })}>
                新建用户
              </Button>
            ) : null}
          </Space>
        }
      />

      {usersQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="用户列表加载失败"
          description="请确认当前账号拥有 user:read 权限。"
        />
      ) : null}
      {canReadRoles && (rolesQuery.isError || permissionsQuery.isError) ? (
        <Alert
          type="warning"
          showIcon
          message="角色或权限列表加载失败"
          description="编辑用户时不会修改角色，避免误清空现有授权。"
        />
      ) : null}

      <Card variant="outlined" styles={{ body: { padding: 18 } }}>
        <Flex justify="space-between" wrap gap={12} style={{ marginBottom: 14 }}>
          <Space wrap>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索用户名"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onPressEnter={() => {
                setSearch(searchDraft.trim())
                setPage(1)
              }}
              allowClear
              onClear={() => {
                setSearch('')
                setPage(1)
              }}
              style={{ width: 240 }}
            />
            <Button
              onClick={() => {
                setSearch(searchDraft.trim())
                setPage(1)
              }}
            >
              搜索
            </Button>
            <Select
              mode="multiple"
              placeholder="审批状态"
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value)
                setPage(1)
              }}
              options={STATUS_OPTIONS}
              maxTagCount="responsive"
              style={{ minWidth: 190 }}
            />
          </Space>
          <Space>
            <TeamOutlined style={{ color: token.colorTextTertiary }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {usersQuery.data?.total ?? 0} 条
            </Text>
          </Space>
        </Flex>

        <AdminUsersTable
          users={usersQuery.data?.items ?? []}
          total={usersQuery.data?.total ?? 0}
          loading={usersQuery.isFetching}
          page={page}
          pageSize={pageSize}
          currentUserId={currentUser?.id}
          canWriteUsers={canWriteUsers}
          onPageChange={(nextPage, nextSize) => {
            setPage(nextPage)
            setPageSize(nextSize)
          }}
          onEdit={(user) => setEditor({ mode: 'edit', user })}
          onApprove={setApproveUser}
          onReject={handleReject}
          onDelete={handleDelete}
          onSessions={setSessionsUser}
        />
      </Card>

      {editor ? (
        <UserEditorModal
          mode={editor.mode}
          user={editor.user}
          roles={rolesQuery.data ?? []}
          permissions={permissionsQuery.data ?? []}
          rolesLoading={rolesQuery.isLoading}
          permissionsLoading={permissionsQuery.isLoading}
          canReadRoles={canEditRoles}
          onClose={() => setEditor(null)}
          onSaved={invalidateUsers}
        />
      ) : null}

      {approveUser ? (
        <ApproveUserModal
          user={approveUser}
          roles={rolesQuery.data ?? []}
          permissions={permissionsQuery.data ?? []}
          rolesLoading={rolesQuery.isLoading}
          permissionsLoading={permissionsQuery.isLoading}
          canReadRoles={canEditRoles}
          onClose={() => setApproveUser(null)}
          onApproved={invalidateUsers}
        />
      ) : null}

      {sessionsUser ? (
        <UserSessionsDrawer
          user={sessionsUser}
          onClose={() => setSessionsUser(null)}
        />
      ) : null}
    </Flex>
  )
}
