import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'
import { usePermission } from '../../features/auth/use-permission'

export function RequirePermission({
  permission,
  children,
}: {
  permission: string
  children: React.ReactNode
}) {
  const { has } = usePermission()
  const navigate = useNavigate()

  if (has(permission)) return <>{children}</>

  return (
    <Result
      status="403"
      title="没有权限访问此页面"
      subTitle={`当前账号缺少 ${permission} 权限。`}
      extra={
        <Button type="primary" onClick={() => navigate('/admin')}>
          返回管理概览
        </Button>
      }
    />
  )
}
