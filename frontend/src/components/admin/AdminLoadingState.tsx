import React from 'react';
import { LoadingSignal } from '../LoadingSignal';

interface AdminLoadingStateProps {
  ariaLabel: string;
  label: string;
  detail: string;
}

const AdminLoadingState: React.FC<AdminLoadingStateProps> = ({
  ariaLabel,
  label,
  detail,
}) => (
  <div className="flex min-h-56 items-center border border-border px-5 py-10 md:px-8">
    <LoadingSignal
      ariaLabel={ariaLabel}
      meta="Admin / Secure Data"
      label={label}
      detail={detail}
      className="mx-auto max-w-3xl"
    />
  </div>
);

export default AdminLoadingState;
