import { Link } from 'react-router-dom'
import { ArrowUpRight, Wrench } from 'lucide-react'

import { LoadingSignal } from '@/components/LoadingSignal'
import { PageHeader } from '@/components/PageHeader'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import type { ToolDefinition } from '@/config/tools'
import { useVisibleTools } from '@/hooks/useToolsMeta'

const ToolCard: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  const Icon = tool.icon
  return (
    <Link to={tool.path} className="block">
      <Card size="sm" className="h-full transition-colors hover:bg-muted/40">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <Icon className="size-4 text-muted-foreground" />
            <ArrowUpRight className="size-4 text-muted-foreground" />
          </div>
          <CardTitle>{tool.name}</CardTitle>
          <CardDescription>{tool.description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  )
}

const Dashboard: React.FC = () => {
  const { visibleTools, isPending, hasAccess } = useVisibleTools()

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="工具" description="选择一个工具开始工作。" />

      {isPending ? (
        <LoadingSignal ariaLabel="正在加载工具列表" label="正在加载工具列表" />
      ) : visibleTools.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wrench />
            </EmptyMedia>
            <EmptyTitle>当前账号没有可用的工具</EmptyTitle>
            <EmptyDescription>
              {hasAccess
                ? '管理员尚未启用任何工具，请稍后再试或联系管理员。'
                : '请联系管理员为你的账号分配角色后重新登录。'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}

export default Dashboard
