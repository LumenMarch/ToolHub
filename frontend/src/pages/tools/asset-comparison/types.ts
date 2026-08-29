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
  status: 'pending' | 'running' | 'ready' | 'failed';
  counts?: {
    new: number;
    removed: number;
    anomaly: number;
  };
  sub_groups?: SubGroup[];
}

export type DifferenceType =
  | 'all'
  | 'new'
  | 'removed'
  | 'anomaly'
  | 'custodianNew'
  | 'custodianRemoved'
  | 'deptNew'
  | 'deptRemoved';

export interface DifferenceTotals {
  all: number;
  new: number;
  removed: number;
  anomaly: number;
  custodianNew: number;
  custodianRemoved: number;
  deptNew: number;
  deptRemoved: number;
}

export interface DifferenceRecord {
  id: string;
  changeType: Exclude<DifferenceType, 'all'>;
  dimension: string;
  identifier: string;
  name: string;
  owner: string;
  sourceLabel: string;
  detail: string;
}

export interface DifferenceDetails {
  moduleKey: string;
  records: DifferenceRecord[];
  totals: DifferenceTotals;
  filteredTotal: number;
  offset: number;
  limit: number;
}

export interface JobArtifact {
  status:
    | 'blocked'
    | 'pending'
    | 'building'
    | 'ready'
    | 'stale'
    | 'failed'
    | 'expired';
  moduleKey?: string;
  downloadUrl?: string;
  filename?: string;
  sizeBytes?: number;
  checksum?: string;
  error?: string;
}

export interface FinalizeBlocker {
  code:
    | 'job_not_finalizable'
    | 'comparison_not_ready'
    | 'artifacts_not_ready'
    | 'missing_remarks'
    | 'comparison_snapshot_unavailable';
  message: string;
  moduleKeys?: string[];
  artifactKeys?: string[];
}

export interface AssetComparisonJob {
  jobId: string;
  inputs: AssetComparisonInputs;
  inputFingerprint: string;
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
    comparison?: {
      completed: number;
      ready: number;
      failed: number;
      total: number;
    };
    moduleArtifacts?: {
      completed: number;
      ready: number;
      failed: number;
      total: number;
    };
    rawData?: { status: string; error?: string };
  };
  canFinalize: boolean;
  finalizeBlockers: FinalizeBlocker[];
  error?: string | null;
  createdAt?: string | null;
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
