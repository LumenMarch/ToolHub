import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 text-base', className)}>
      <span className="font-semibold tracking-tight">工具</span>
      <span className="text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
        Tool
      </span>
    </span>
  )
}
