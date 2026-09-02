import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Wrench } from 'lucide-react'

import { LoadingSignal } from '@/components/LoadingSignal'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
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

const PINNED_TOOL_IDS = new Set([
  'asset-comparison',
  'attendance-organizer',
  'atlas-merge',
  'cpk-charts',
])
const OTHERS_STORAGE_KEY = 'toolhub-console-other-collapsed'

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
  const [otherCollapsed, setOtherCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(OTHERS_STORAGE_KEY) !== 'false'
  })

  const pinnedTools = visibleTools.filter((tool) => PINNED_TOOL_IDS.has(tool.id))
  const otherTools = visibleTools.filter((tool) => !PINNED_TOOL_IDS.has(tool.id))

  const toggleOthers = () => {
    const next = !otherCollapsed
    setOtherCollapsed(next)
    localStorage.setItem(OTHERS_STORAGE_KEY, String(next))
  }

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
        <>
          {pinnedTools.length > 0 ? (
            <section className="flex flex-col gap-4" aria-label="常用工具">
              <h2 className="text-sm font-medium text-muted-foreground">常用</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pinnedTools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            </section>
          ) : null}

          {otherTools.length > 0 ? (
            <section className="flex flex-col gap-4" aria-label="其它工具">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-medium text-muted-foreground">
                  其它工具
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={toggleOthers}
                  aria-expanded={!otherCollapsed}
                  aria-controls="other-tools-grid"
                >
                  {otherCollapsed ? '展开' : '收起'}
                </Button>
              </div>
              {otherCollapsed ? null : (
                <div
                  id="other-tools-grid"
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {otherTools.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

export default Dashboard
