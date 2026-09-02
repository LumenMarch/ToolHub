import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

interface LoadingSignalProps {
  ariaLabel: string
  label: string
  detail?: string
  meta?: string
  compact?: boolean
  className?: string
}

export const LoadingSignal: React.FC<LoadingSignalProps> = ({
  ariaLabel,
  label,
  detail,
  compact = false,
  className,
}) => {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={cn('flex items-center gap-3', className)}
    >
      <Spinner />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('text-sm', compact && 'text-xs')}>{label}</span>
        {detail ? (
          <span className="text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </div>
    </div>
  )
}
