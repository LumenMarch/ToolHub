import { useEffect } from 'react'
import { Button, Result, Space, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './auth-context'
import { AuthLayout } from '../../app/layout/auth-layout'

const { Text } = Typography

export function PendingPage() {
  const { user, logout, refresh } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user?.status === 'approved') {
      navigate('/', { replace: true })
    }
  }, [navigate, user?.status])

  return (
    <AuthLayout>
      <Result
        status="info"
        title="账号待审批"
        subTitle={
          <Space direction="vertical" size={6}>
            <Text>你好，{user?.username ?? '用户'}。</Text>
            <Text type="secondary">
              注册申请已提交，审批通过后会自动进入工具台。
            </Text>
            <Tag color="gold" bordered={false}>
              审核中
            </Tag>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
              刷新状态
            </Button>
            <Button
              onClick={() => {
                void logout().then(() => navigate('/login', { replace: true }))
              }}
            >
              退出登录
            </Button>
          </Space>
        }
      />
    </AuthLayout>
  )
}
