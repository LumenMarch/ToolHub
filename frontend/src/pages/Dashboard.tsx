import { Link } from 'react-router-dom'
import { ArrowUpRight, Wrench } from 'lucide-react'

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
import { Skeleton } from '@/components/ui/skeleton'
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
      className="block rounded-lg animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-(--ds-duration-slow) ease-enter"
      style={{
        animationDelay: `${Math.min(index * CARD_STAGGER_MS, CARD_STAGGER_CAP_MS)}ms`,
      }}
    >
      <Card className="group h-full transition-[border-color,background-color,transform] duration-(--ds-duration-fast) ease-standard hover:border-primary/40 hover:bg-accent-soft/30 motion-safe:active:scale-[.995]">
        <CardHeader className="gap-3">
          <div className="flex items-start justify-between gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors duration-(--ds-duration-fast) group-hover:bg-accent-soft group-hover:text-primary">
              <Icon className="size-4" />
            </span>
            <ArrowUpRight
              aria-hidden="true"
              className="size-4 shrink-0 text-faint transition-[color,transform] duration-(--ds-duration-fast) ease-standard group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <CardTitle>{tool.name}</CardTitle>
            <CardDescription className="line-clamp-2 leading-relaxed">
              {tool.description}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    </Link>
  )
}

/** 加载态与工具卡片网格同形：骨架直接占住最终布局的位置，不强制视线重定位。 */
const ToolGridSkeleton: React.FC = () => (
  <div
    role="status"
    aria-label="正在加载工具列表"
    className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
  >
    {Array.from({ length: 8 }, (_, index) => (
      <Card key={index} aria-hidden="true">
        <CardHeader className="gap-3">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-4 rounded-sm" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3.5 w-5/6" />
          </div>
        </CardHeader>
      </Card>
    ))}
  </div>
)

const Dashboard: React.FC = () => {
  const { visibleTools, isPending, hasAccess } = useVisibleTools()

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="工具" description="选择一个工具开始工作。">
        {!isPending && visibleTools.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {visibleTools.length} 个工具
          </span>
        ) : null}
      </PageHeader>

      {isPending ? (
        <ToolGridSkeleton />
      ) : visibleTools.length === 0 ? (
        <Empty className="border border-dashed bg-card">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleTools.map((tool, index) => (
            <ToolCard key={tool.id} tool={tool} index={index} />
          ))}
        </div>
      )}
    </div>
  )
}

export default Dashboard
