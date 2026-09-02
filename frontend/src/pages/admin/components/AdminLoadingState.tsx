import { LoadingSignal } from '@/components/LoadingSignal'

interface AdminLoadingStateProps {
  ariaLabel: string
  label: string
  detail: string
}

const AdminLoadingState: React.FC<AdminLoadingStateProps> = ({
  ariaLabel,
  label,
  detail,
}) => (
  <div className="flex min-h-56 items-center justify-center rounded-xl border px-5 py-10">
    <LoadingSignal ariaLabel={ariaLabel} label={label} detail={detail} />
  </div>
)

export default AdminLoadingState
