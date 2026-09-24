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

/** 卡片入场的交错间隔与总延迟上限：总共约 350ms 内播完，不拖慢首屏阅读。 */
const CARD_STAGGER_MS = 30
const CARD_STAGGER_CAP_MS = 150

const ToolCard: React.FC<{ tool: ToolDefinition; index: number }> = ({
  tool,
  index,
}) => {
  const Icon = tool.icon
  return (
    <Link
      to={tool.path}
      className="block animate-in fade-in-0 slide-in-from-bottom-1 animation-duration-200 fill-mode-backwards ease-out-strong"
      style={{
        animationDelay: `${Math.min(index * CARD_STAGGER_MS, CARD_STAGGER_CAP_MS)}ms`,
      }}
    >
      <Card
        size="sm"
        className="h-full transition-[background-color,transform] duration-150 ease-out-strong hover:bg-muted/40 motion-safe:active:translate-y-px"
      >
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
          {visibleTools.map((tool, index) => (
            <ToolCard key={tool.id} tool={tool} index={index} />
          ))}
        </div>
      )}
    </div>
  )
}

export default Dashboard
