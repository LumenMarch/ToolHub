import { useEffect, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Segmented,
  Space,
  Typography,
} from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { loginSession, registerAccount } from '../../api/auth'
import { isBackendUnreachable, readApiErrorMessage } from '../../api/errors'
import { useAuth } from './auth-context'
import { AuthLayout } from '../../app/layout/auth-layout'

const { Title, Text } = Typography

type Mode = 'login' | 'register'

interface LoginValues {
  username: string
  password: string
}

function readRedirectPath(state: unknown): string {
  if (!state || typeof state !== 'object' || !('from' in state)) return '/'
  return typeof state.from === 'string' && state.from.startsWith('/') ? state.from : '/'
}

export function LoginPage() {
  const { user, login } = useAuth()
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('login')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [form] = Form.useForm<LoginValues>()

  useEffect(() => {
    if (!user) return
    navigate(user.status === 'pending' ? '/pending' : '/', { replace: true })
  }, [navigate, user])

  const handleSubmit = async (values: LoginValues) => {
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'login') {
        const authenticated = await loginSession(values.username, values.password)
        login(authenticated)
        message.success('登录成功')
        navigate(
          authenticated.status === 'pending'
            ? '/pending'
            : readRedirectPath(location.state),
          { replace: true },
        )
        return
      }

      await registerAccount(values.username, values.password)
      message.success('注册已提交，请等待管理员审批')
      setMode('login')
      form.setFieldValue('password', '')
    } catch (submitError) {
      setError(
        isBackendUnreachable(submitError)
          ? '暂时无法连接服务，请稍后重试。'
          : readApiErrorMessage(submitError) ?? '操作失败，请稍后重试。',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError('')
    form.resetFields()
  }

  return (
    <AuthLayout>
      <Card
        style={{ width: '100%', maxWidth: 400 }}
        styles={{ body: { padding: 26 } }}
      >
        <Flex vertical gap={16}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {mode === 'login' ? '登录' : '注册账号'}
            </Title>
            <Text type="secondary">
              {mode === 'login'
                ? '使用账号进入工具台。'
                : '提交注册后需要管理员审批。'}
            </Text>
          </div>

          <Segmented
            block
            value={mode}
            onChange={(value) => switchMode(value as Mode)}
            options={[
              { label: '登录', value: 'login' },
              { label: '注册', value: 'register' },
            ]}
          />

          {error ? (
            <Alert
              type="error"
              showIcon
              closable
              message={error}
              onClose={() => setError('')}
            />
          ) : null}

          <Form<LoginValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={(values) => void handleSubmit(values)}
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="请输入用户名"
                autoComplete="username"
                size="large"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: '请输入密码' },
                {
                  validator: (_, value: string) => {
                    if (mode === 'login' || !value || value.length >= 6) {
                      return Promise.resolve()
                    }
                    return Promise.reject(new Error('密码长度至少 6 位'))
                  },
                },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder={mode === 'login' ? '请输入密码' : '至少 6 位'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                size="large"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={submitting}
            >
              {mode === 'login' ? '登录' : '提交注册'}
            </Button>
          </Form>

          <Space size={4} style={{ justifyContent: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {mode === 'login' ? '没有账号？' : '已有账号？'}
            </Text>
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0 }}
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? '注册' : '登录'}
            </Button>
          </Space>
        </Flex>
      </Card>
    </AuthLayout>
  )
}
