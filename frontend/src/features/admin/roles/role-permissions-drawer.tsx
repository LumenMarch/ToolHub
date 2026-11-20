import { useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Col,
  Drawer,
  Flex,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getRolePermissions,
  listPermissions,
  setRolePermissions,
} from '../../../api/admin'
import type { PermissionSummary, RoleSummary } from '../../../api/admin'
import { readApiErrorMessage } from '../../../api/errors'
import {
  adminPermissionsQueryKey,
  adminRolePermissionsQueryKey,
  adminRolesQueryKey,
} from '../query-keys'

const { Text } = Typography

const GROUP_ORDER = [
  { key: 'user', label: '用户管理' },
  { key: 'role', label: '角色管理' },
  { key: 'audit', label: '审计' },
  { key: 'stats', label: '统计' },
  { key: 'tool_meta', label: '工具目录' },
  { key: 'llm_config', label: '模型服务' },
  { key: 'tool', label: '工具使用' },
]

function groupKey(codename: string): string {
  if (codename.startsWith('tool:')) return 'tool'
  return codename.split(':')[0] ?? 'other'
}

function groupPermissions(permissions: PermissionSummary[]) {
  const groups = new Map<string, PermissionSummary[]>()
  for (const permission of permissions) {
    const key = groupKey(permission.codename)
    const current = groups.get(key) ?? []
    current.push(permission)
    groups.set(key, current)
  }
  return GROUP_ORDER.filter((group) => groups.has(group.key)).map((group) => ({
    ...group,
    items: groups.get(group.key) ?? [],
  }))
}

function PermissionChecklist({
  role,
  permissions,
  initialSelected,
  onClose,
}: {
  role: RoleSummary
  permissions: PermissionSummary[]
  initialSelected: number[]
  onClose: () => void
}) {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<number[]>(initialSelected)
  const [error, setError] = useState('')
  const readonly = role.is_builtin
  const groups = useMemo(() => groupPermissions(permissions), [permissions])
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const saveMutation = useMutation({
    mutationFn: () => setRolePermissions(role.id, selected),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminRolesQueryKey })
      void queryClient.invalidateQueries({
        queryKey: adminRolePermissionsQueryKey(role.id),
      })
      message.success('角色权限已保存')
      onClose()
    },
    onError: (saveError) => {
      setError(readApiErrorMessage(saveError) ?? '保存失败，请稍后重试。')
    },
  })

  return (
    <Drawer
      open
      onClose={onClose}
      size="large"
      title={`权限配置 · ${role.name}`}
      extra={
        <Tag color={readonly ? 'gold' : 'blue'} bordered={false}>
          {readonly ? '内置角色只读' : '自定义角色'}
        </Tag>
      }
      footer={
        <Flex justify="space-between" align="center" gap={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            已选 {selected.length} / {permissions.length} 项
          </Text>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              disabled={readonly}
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              保存权限
            </Button>
          </Space>
        </Flex>
      }
    >
      {readonly ? (
        <Alert
          type="info"
          showIcon
          message="内置角色权限由代码定义"
          description="可以查看当前权限，但不能通过接口修改。如需自定义权限，请创建新角色。"
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {error ? (
        <Alert
          type="error"
          showIcon
          closable
          message={error}
          style={{ marginBottom: 16 }}
          onClose={() => setError('')}
        />
      ) : null}

      <Checkbox.Group
        value={selected}
        onChange={(values) => setSelected(values as number[])}
        style={{ width: '100%' }}
        disabled={readonly}
      >
        <Row gutter={[12, 12]}>
          {groups.map((group) => {
            const groupIds = group.items.map((item) => item.id)
            const allSelected = groupIds.every((id) => selectedSet.has(id))
            return (
              <Col key={group.key} xs={24} xl={12}>
                <Card
                  size="small"
                  variant="outlined"
                  title={
                    <Flex justify="space-between" align="center" gap={8}>
                      <span>{group.label}</span>
                      <Space size={4}>
                        <Button
                          type="link"
                          size="small"
                          disabled={readonly}
                          onClick={() =>
                            setSelected((previous) => [
                              ...new Set([...previous, ...groupIds]),
                            ])
                          }
                        >
                          {allSelected ? '已全选' : '全选'}
                        </Button>
                        <Button
                          type="link"
                          size="small"
                          disabled={readonly}
                          onClick={() =>
                            setSelected((previous) => {
                              const groupSet = new Set(groupIds)
                              return previous.filter((id) => !groupSet.has(id))
                            })
                          }
                        >
                          清空
                        </Button>
                      </Space>
                    </Flex>
                  }
                  styles={{ body: { padding: '10px 12px' } }}
                >
                  <Flex vertical gap={8}>
                    {group.items.map((permission) => (
                      <Checkbox key={permission.id} value={permission.id}>
                        <Flex vertical gap={0} style={{ marginLeft: 2 }}>
                          <Text style={{ fontSize: 12 }}>{permission.description}</Text>
                          <Text type="secondary" className="mono" style={{ fontSize: 10 }}>
                            {permission.codename}
                          </Text>
                        </Flex>
                      </Checkbox>
                    ))}
                  </Flex>
                </Card>
              </Col>
            )
          })}
        </Row>
      </Checkbox.Group>
    </Drawer>
  )
}

export function RolePermissionsDrawer({
  role,
  onClose,
}: {
  role: RoleSummary
  onClose: () => void
}) {
  const allQuery = useQuery({
    queryKey: adminPermissionsQueryKey,
    queryFn: listPermissions,
    staleTime: 5 * 60_000,
  })
  const roleQuery = useQuery({
    queryKey: adminRolePermissionsQueryKey(role.id),
    queryFn: () => getRolePermissions(role.id),
    staleTime: 30_000,
  })

  if (allQuery.isPending || roleQuery.isPending) {
    return (
      <Drawer open onClose={onClose} size="large" title={`权限配置 · ${role.name}`}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Drawer>
    )
  }

  if (allQuery.isError || roleQuery.isError) {
    return (
      <Drawer open onClose={onClose} size="large" title={`权限配置 · ${role.name}`}>
        <Alert
          type="error"
          showIcon
          message="权限数据加载失败"
          description="请确认当前账号拥有 role:read 权限。"
        />
      </Drawer>
    )
  }

  return (
    <PermissionChecklist
      role={role}
      permissions={allQuery.data}
      initialSelected={roleQuery.data.map((permission) => permission.id)}
      onClose={onClose}
    />
  )
}
