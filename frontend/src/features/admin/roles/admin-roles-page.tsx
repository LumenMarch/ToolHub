import { useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../../app/components/page-header'
import { deleteRole, listRoles } from '../../../api/admin'
import type { RoleSummary } from '../../../api/admin'
import { readApiErrorMessage } from '../../../api/errors'
import { usePermission } from '../../auth/use-permission'
import { adminRolesQueryKey } from '../query-keys'
import { RoleEditorModal } from './role-editor-modal'
import { RolePermissionsDrawer } from './role-permissions-drawer'

const { Text } = Typography

export function AdminRolesPage() {
  const { message, modal } = AntApp.useApp()
  const queryClient = useQueryClient()
  const { has } = usePermission()
  const canWrite = has('role:write')

  const [editorRole, setEditorRole] = useState<RoleSummary | 'new' | null>(null)
  const [permissionsRole, setPermissionsRole] = useState<RoleSummary | null>(null)

  const rolesQuery = useQuery({
    queryKey: adminRolesQueryKey,
    queryFn: listRoles,
    staleTime: 30_000,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: adminRolesQueryKey })
  }

  const handleDelete = (role: RoleSummary) => {
    modal.confirm({
      title: '删除角色',
      content: `确定删除「${role.name}」吗？持有该角色的用户会立即失去对应权限。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteRole(role.id)
          message.success('角色已删除')
          invalidate()
        } catch (error) {
          message.error(readApiErrorMessage(error) ?? '删除失败')
          throw error
        }
      },
    })
  }

  const columns: TableProps<RoleSummary>['columns'] = [
    {
      title: '角色名',
      dataIndex: 'name',
      width: 220,
      render: (name: string, role) => (
        <Space size={8}>
          <Text strong>{name}</Text>
          {role.is_builtin ? (
            <Tag color="gold" bordered={false} style={{ marginInlineEnd: 0 }}>
              内置
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      render: (description: string) =>
        description ? (
          <Text type="secondary">{description}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '权限数',
      dataIndex: 'permission_count',
      width: 100,
      render: (count: number) => (
        <Text className="mono" strong>
          {count}
        </Text>
      ),
    },
    {
      title: '类型',
      key: 'type',
      width: 110,
      render: (_, role) => (
        <Tag color={role.is_builtin ? 'gold' : 'blue'} bordered={false}>
          {role.is_builtin ? '代码定义' : '自定义'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 230,
      render: (_, role) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<SafetyCertificateOutlined />}
            onClick={() => setPermissionsRole(role)}
          >
            权限
          </Button>
          {canWrite ? (
            <>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => setEditorRole(role)}
              >
                编辑
              </Button>
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={role.is_builtin}
                onClick={() => handleDelete(role)}
              >
                删除
              </Button>
            </>
          ) : null}
        </Space>
      ),
    },
  ]

  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="角色与权限"
        description="角色是一组权限的集合；内置角色由代码定义，自定义角色可自由组合权限。"
        eyebrow={
          <Space size={6}>
            <Tag color="purple" bordered={false}>
              {rolesQuery.data?.length ?? 0} 个角色
            </Tag>
            <Tag bordered={false}>权限按域分组</Tag>
          </Space>
        }
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void rolesQuery.refetch()}>
              刷新
            </Button>
            {canWrite ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setEditorRole('new')}
              >
                新建角色
              </Button>
            ) : null}
          </Space>
        }
      />

      {rolesQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="角色列表加载失败"
          description="请确认当前账号拥有 role:read 权限。"
        />
      ) : null}

      <Card variant="outlined" styles={{ body: { padding: 18 } }}>
        <Table<RoleSummary>
          rowKey="id"
          columns={columns}
          dataSource={rolesQuery.data ?? []}
          loading={rolesQuery.isFetching}
          size="middle"
          pagination={false}
          scroll={{ x: 900 }}
        />
      </Card>

      {editorRole ? (
        <RoleEditorModal
          role={editorRole === 'new' ? undefined : editorRole}
          onClose={() => setEditorRole(null)}
          onSaved={invalidate}
        />
      ) : null}

      {permissionsRole ? (
        <RolePermissionsDrawer
          role={permissionsRole}
          onClose={() => setPermissionsRole(null)}
        />
      ) : null}
    </Flex>
  )
}
