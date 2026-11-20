import { useState } from 'react'
import {
  Alert,
  App as AntApp,
  Descriptions,
  Flex,
  Form,
  Modal,
  Select,
} from 'antd'
import { approveAdminUser } from '../../../api/admin'
import type { AdminUser, PermissionSummary, RoleSummary } from '../../../api/admin'
import { readApiErrorMessage } from '../../../api/errors'
import { toolPermissionOptions } from './permission-options'
import { parseServerDate } from '../../../lib/date'

interface FormValues {
  role_ids: number[]
  tool_permission_ids: number[]
}

interface ApproveUserModalProps {
  user: AdminUser
  roles: RoleSummary[]
  permissions: PermissionSummary[]
  rolesLoading: boolean
  permissionsLoading: boolean
  canReadRoles: boolean
  onClose: () => void
  onApproved: () => void
}

export function ApproveUserModal({
  user,
  roles,
  permissions,
  rolesLoading,
  permissionsLoading,
  canReadRoles,
  onClose,
  onApproved,
}: ApproveUserModalProps) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const defaultRole = roles.find((role) => role.name === '工具使用者')
  const toolPermissionOptionsList = toolPermissionOptions(permissions)

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true)
    setError('')
    try {
      await approveAdminUser(user.id, {
        ...(canReadRoles ? { role_ids: values.role_ids } : {}),
        ...(canReadRoles ? { tool_permission_ids: values.tool_permission_ids } : {}),
      })
      message.success(`已通过 ${user.username} 的注册申请`)
      onApproved()
      onClose()
    } catch (submitError) {
      setError(readApiErrorMessage(submitError) ?? '审批失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title="通过审批"
      okText="通过审批"
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: rolesLoading || permissionsLoading }}
      onOk={() => form.submit()}
      onCancel={onClose}
      width={560}
    >
      <Flex vertical gap={16} style={{ marginTop: 8 }}>
        <Descriptions
          size="small"
          column={1}
          items={[
            { key: 'username', label: '账号', children: user.username },
            {
              key: 'created',
              label: '注册时间',
              children: parseServerDate(user.created_at).format('YYYY-MM-DD HH:mm'),
            },
          ]}
        />
        {error ? (
          <Alert type="error" showIcon message={error} closable onClose={() => setError('')} />
        ) : null}
        {!canReadRoles ? (
          <Alert
            type="warning"
            showIcon
            message="当前账号缺少 role:read 权限"
            description="将通过审批并分配服务端默认的「工具使用者」角色。"
          />
        ) : null}
        <Form<FormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{
            role_ids: defaultRole ? [defaultRole.id] : [],
            tool_permission_ids: [],
          }}
          onFinish={(values) => void handleSubmit(values)}
        >
          <Form.Item name="role_ids" label="角色">
            <Select
              mode="multiple"
              placeholder="选择角色"
              loading={rolesLoading}
              disabled={!canReadRoles || rolesLoading}
              options={roles.map((role) => ({
                value: role.id,
                label: role.is_builtin ? `${role.name}（内置）` : role.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="tool_permission_ids"
            label="直接工具权限"
            extra="角色之外的例外授权；角色已包含的工具权限无需重复勾选。"
          >
            <Select
              mode="multiple"
              placeholder="选择工具权限"
              loading={permissionsLoading}
              disabled={permissionsLoading || !canReadRoles}
              options={toolPermissionOptionsList}
              maxTagCount="responsive"
            />
          </Form.Item>
        </Form>
        <Alert
          type="info"
          showIcon
          message="通过后用户会收到站内通知"
          description="审批会立即生效；用户下次进入工作台时会按新权限加载工具。"
        />
      </Flex>
    </Modal>
  )
}
