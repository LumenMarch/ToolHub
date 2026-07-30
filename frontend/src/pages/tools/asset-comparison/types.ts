export interface SubGroup {
  label: string;
  new_count: number;
  removed_count: number;
  anomaly_count: number;
  has_diff: boolean;
}

export interface CheckResult {
  key: string;
  label: string;
  has_diff: boolean;
  msg: string;
  status: 'ready' | 'failed';
  sub_groups?: SubGroup[];
}

export interface JobArtifact {
  status: 'blocked' | 'pending' | 'building' | 'ready' | 'stale' | 'failed';
  moduleKey?: string;
  downloadUrl?: string;
  filename?: string;
  sizeBytes?: number;
  error?: string;
}

export interface FinalizeBlocker {
  code:
    | 'comparison_not_ready'
    | 'artifacts_not_ready'
    | 'missing_remarks'
    | 'runtime_unavailable';
  message: string;
  moduleKeys?: string[];
  artifactKeys?: string[];
}

export interface AssetComparisonJob {
  jobId: string;
  inputs: AssetComparisonInputs;
  status:
    | 'queued'
    | 'validating'
    | 'running'
    | 'base_ready'
    | 'finalizing'
    | 'complete'
    | 'partial_failed'
    | 'failed'
    | 'cancel_requested'
    | 'cancelled'
    | 'expired';
  results: CheckResult[];
  artifacts: Record<string, JobArtifact>;
  remarks: Record<string, string>;
  reviews: Record<string, string>;
  annotationRevision: number;
  finalizedRevision: number | null;
  progress: {
    validation?: { status: string };
    comparison?: { completed: number; total: number };
    moduleArtifacts?: { completed: number; total: number };
    rawData?: { status: string; error?: string };
  };
  canFinalize: boolean;
  finalizeBlockers: FinalizeBlocker[];
  error?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
}

export type AssetComparisonInputs = {
  thisFinance: string;
  lastFinance: string;
  thisSFC: string;
  lastSFC: string;
  thisNotes: string;
  lastNotes: string;
  thisCustomer: string;
  lastCustomer: string;
  departmentData: string;
  custodianData: string;
  driData: string;
};
