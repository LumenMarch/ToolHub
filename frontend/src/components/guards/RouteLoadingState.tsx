import { LoadingSignal } from '../LoadingSignal'
import { cn } from '../../lib/cn'

interface RouteLoadingStateProps {
  fullScreen?: boolean
  label?: string
  detail?: string
  meta?: string
}

const RouteLoadingState: React.FC<RouteLoadingStateProps> = ({
  fullScreen = true,
  label = '正在验证会话',
  detail = '等待凭据确认',
}) => (
  <div
    className={cn(
      'flex w-full items-center justify-center bg-background px-8',
      fullScreen ? 'min-h-dvh' : 'min-h-[40vh]',
    )}
  >
    <LoadingSignal ariaLabel={label} label={label} detail={detail} />
  </div>
)

export default RouteLoadingState
