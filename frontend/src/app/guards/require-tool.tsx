import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'
import { usePermission } from '../../features/auth/use-permission'
import { useVisibleTools } from '../../features/dashboard/use-visible-tools'
import type { ToolDefinition } from '../../features/dashboard/tool-catalog'
import { RouteFallback } from '../components/route-fallback'

interface RequireToolProps {
  tool: ToolDefinition
  children: React.ReactNode
}

export function RequireTool({ tool, children }: RequireToolProps) {
  const { has } = usePermission()
  const { tools, isLoading } = useVisibleTools()
  const navigate = useNavigate()

  if (isLoading) return <RouteFallback />

  const enabled = tools.some((item) => item.id === tool.id)
  if (!has(tool.permission) || !enabled) {
    return (
      <Result
        status="403"
        title="无法使用该工具"
        subTitle="当前账号没有该工具权限，或管理员已停用该工具。"
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            返回工作台
          </Button>
        }
      />
    )
  }

  return <>{children}</>
}
