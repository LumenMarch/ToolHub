import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span className="font-semibold tracking-tight">工具</span>
      <span className="text-xs text-muted-foreground">Tool</span>
    </span>
  )
}
