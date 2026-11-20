import { useState } from 'react'
import { Alert, App as AntApp, Form, Input, Modal, Typography } from 'antd'
import { createRole, updateRole } from '../../../api/admin'
import type { RoleSummary } from '../../../api/admin'
import { readApiErrorMessage } from '../../../api/errors'

const { Text } = Typography

interface RoleFormValues {
  name: string
  description: string
}

interface RoleEditorModalProps {
  role?: RoleSummary
  onClose: () => void
  onSaved: () => void
}

export function RoleEditorModal({ role, onClose, onSaved }: RoleEditorModalProps) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<RoleFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const builtin = Boolean(role?.is_builtin)

  const handleSubmit = async (values: RoleFormValues) => {
    setSubmitting(true)
    setError('')
    try {
      if (role) {
        await updateRole(role.id, {
          ...(builtin ? {} : { name: values.name.trim() }),
          description: values.description.trim(),
        })
        message.success('角色已更新')
      } else {
        await createRole({
          name: values.name.trim(),
          description: values.description.trim(),
        })
        message.success('角色已创建')
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
      title={role ? `编辑角色 · ${role.name}` : '新建角色'}
      okText={role ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => form.submit()}
      onCancel={onClose}
      width={480}
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
      {builtin ? (
        <Alert
          type="info"
          showIcon
          message="内置角色"
          description="角色名称与权限由代码定义，只能修改描述。"
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form<RoleFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{
          name: role?.name ?? '',
          description: role?.description ?? '',
        }}
        onFinish={(values) => void handleSubmit(values)}
      >
        <Form.Item
          name="name"
          label="角色名"
          rules={[{ required: true, message: '请输入角色名' }]}
          extra={builtin ? '内置角色名称不可修改。' : undefined}
        >
          <Input placeholder="例如：质量分析员" disabled={builtin} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="这个角色负责什么？" />
        </Form.Item>
      </Form>
      <Text type="secondary" style={{ fontSize: 11 }}>
        权限在角色创建后通过「权限」按钮配置。
      </Text>
    </Modal>
  )
}
