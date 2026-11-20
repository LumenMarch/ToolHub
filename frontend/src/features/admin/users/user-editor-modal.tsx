import { useState } from 'react'
import {
  Alert,
  App as AntApp,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Typography,
} from 'antd'
import { createAdminUser, updateAdminUser } from '../../../api/admin'
import type { AdminUser, PermissionSummary, RoleSummary } from '../../../api/admin'
import { readApiErrorMessage } from '../../../api/errors'
import { directPermissionIds, toolPermissionOptions } from './permission-options'

const { Text } = Typography

interface FormValues {
  username: string
  password?: string
  role_ids: number[]
  tool_permission_ids: number[]
  is_active: boolean
}

interface UserEditorModalProps {
  mode: 'create' | 'edit'
  user?: AdminUser
  roles: RoleSummary[]
  permissions: PermissionSummary[]
  rolesLoading: boolean
  permissionsLoading: boolean
  canReadRoles: boolean
  onClose: () => void
  onSaved: () => void
}

export function UserEditorModal({
  mode,
  user,
  roles,
  permissions,
  rolesLoading,
  permissionsLoading,
  canReadRoles,
  onClose,
  onSaved,
}: UserEditorModalProps) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const defaultRole = roles.find((role) => role.name === '工具使用者')
  const toolPermissionOptionsList = toolPermissionOptions(permissions)

  const initialValues: FormValues = {
    username: user?.username ?? '',
    password: '',
    role_ids: user?.role_ids ?? (defaultRole ? [defaultRole.id] : []),
    tool_permission_ids: directPermissionIds(user, permissions),
    is_active: user?.is_active ?? true,
  }

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true)
    setError('')
    try {
      if (mode === 'create') {
        await createAdminUser({
          username: values.username,
          password: values.password ?? '',
          ...(canReadRoles ? { role_ids: values.role_ids } : {}),
          ...(canReadRoles ? { tool_permission_ids: values.tool_permission_ids } : {}),
        })
        message.success('用户已创建')
      } else if (user) {
        await updateAdminUser(user.id, {
          ...(canReadRoles ? { role_ids: values.role_ids } : {}),
          is_active: values.is_active,
          ...(values.password ? { password: values.password } : {}),
          ...(canReadRoles ? { tool_permission_ids: values.tool_permission_ids } : {}),
        })
        message.success('用户已更新')
      }
      onSaved()
      onClose()
    } catch (submitError) {
      setError(readApiErrorMessage(submitError) ?? '保存失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title={mode === 'create' ? '新建用户' : `编辑用户 · ${user?.username ?? ''}`}
      okText={mode === 'create' ? '创建' : '保存'}
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: rolesLoading || permissionsLoading }}
      onOk={() => form.submit()}
      onCancel={onClose}
      width={560}
    >
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
      {!canReadRoles ? (
        <Alert
          type="warning"
          showIcon
          message="当前账号缺少 role:read 权限"
          description="无法读取角色列表，保存时不会修改用户角色。"
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
        onFinish={(values) => void handleSubmit(values)}
        style={{ marginTop: 8 }}
      >
        <Form.Item
          name="username"
          label="用户名"
          rules={[{ required: true, message: '请输入用户名' }]}
          extra={mode === 'edit' ? '用户名创建后不可修改。' : undefined}
        >
          <Input placeholder="用户名" disabled={mode === 'edit'} autoComplete="off" />
        </Form.Item>

        <Form.Item
          name="password"
          label={mode === 'create' ? '密码' : '重置密码'}
          rules={[
            {
              validator: (_, value: string) => {
                if (mode === 'create' && !value) {
                  return Promise.reject(new Error('请输入密码'))
                }
                if (value && value.length < 6) {
                  return Promise.reject(new Error('密码长度至少 6 位'))
                }
                return Promise.resolve()
              },
            },
          ]}
          extra={mode === 'edit' ? '留空表示不修改密码。' : '至少 6 位。'}
        >
          <Input.Password
            placeholder={mode === 'create' ? '至少 6 位' : '留空不修改'}
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item
          name="role_ids"
          label="角色"
          extra={canReadRoles ? '角色决定用户可访问的工具和管理权限。' : undefined}
        >
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
          extra="角色之外的单用户例外授权；不会覆盖角色权限。"
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

        {mode === 'edit' ? (
          <Form.Item
            name="is_active"
            label="账号状态"
            valuePropName="checked"
            extra="停用会吊销该用户的全部会话。"
          >
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        ) : null}
      </Form>
      <Text type="secondary" style={{ fontSize: 11 }}>
        通过审批会同时设置角色与直接工具权限，并通知用户。
      </Text>
    </Modal>
  )
}
