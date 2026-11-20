import { api } from './client'

export type AssetInputKey =
  | 'thisFinance'
  | 'lastFinance'
  | 'thisSFC'
  | 'lastSFC'
  | 'thisNotes'
  | 'lastNotes'
  | 'thisCustomer'
  | 'lastCustomer'
  | 'departmentData'
  | 'custodianData'
  | 'driData'

export type AssetScanData = Partial<Record<AssetInputKey, string>>

export interface AssetScanResponse {
  status: string
  data: AssetScanData
  scan_id: string
}

export interface AssetSubGroup {
  label: string
  new_count: number
  removed_count: number
  anomaly_count: number
  has_diff: boolean
}

export interface AssetCheckResult {
  key: string
  label: string
  has_diff: boolean
  msg: string
  status: 'pending' | 'running' | 'ready' | 'failed'
  counts?: { new: number; removed: number; anomaly: number }
  sub_groups?: AssetSubGroup[]
}

export type AssetDifferenceType =
  | 'all'
  | 'new'
  | 'removed'
  | 'anomaly'
  | 'custodianNew'
  | 'custodianRemoved'
  | 'deptNew'
  | 'deptRemoved'

export interface AssetDifferenceTotals {
  all: number
  new: number
  removed: number
  anomaly: number
  custodianNew: number
  custodianRemoved: number
  deptNew: number
  deptRemoved: number
}

export interface AssetDifferenceRecord {
  id: string
  changeType: Exclude<AssetDifferenceType, 'all'>
  dimension: string
  identifier: string
  name: string
  owner: string
  sourceLabel: string
  detail: string
}

export interface AssetDifferenceDetails {
  moduleKey: string
  records: AssetDifferenceRecord[]
  totals: AssetDifferenceTotals
  filteredTotal: number
  offset: number
  limit: number
}

export type AssetArtifactStatus =
  | 'blocked'
  | 'pending'
  | 'building'
  | 'ready'
  | 'stale'
  | 'failed'
  | 'expired'

export interface AssetArtifact {
  status: AssetArtifactStatus
  moduleKey?: string
  downloadUrl?: string
  filename?: string
  sizeBytes?: number
  checksum?: string
  error?: string
}

export interface AssetFinalizeBlocker {
  code:
    | 'job_not_finalizable'
    | 'comparison_not_ready'
    | 'artifacts_not_ready'
    | 'missing_remarks'
    | 'comparison_snapshot_unavailable'
  message: string
  moduleKeys?: string[]
  artifactKeys?: string[]
}

export type AssetJobStatus =
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
  | 'expired'

export interface AssetComparisonJob {
  jobId: string
  status: AssetJobStatus
  inputs: AssetScanData
  inputFingerprint: string
  results: AssetCheckResult[]
  artifacts: Record<string, AssetArtifact>
  remarks: Record<string, string>
  reviews: Record<string, string>
  annotationRevision: number
  finalizedRevision: number | null
  progress: {
    validation?: { status: string }
    comparison?: { completed: number; ready: number; failed: number; total: number }
    moduleArtifacts?: { completed: number; ready: number; failed: number; total: number }
    rawData?: { status: string; error?: string }
  }
  canFinalize: boolean
  finalizeBlockers: AssetFinalizeBlocker[]
  error?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  expiresAt?: string | null
}

export const ASSET_MODULE_KEYS = ['ff', 'nn', 'sfc', 'cc', 'fn', 'ns', 'cn'] as const
export type AssetModuleKey = (typeof ASSET_MODULE_KEYS)[number]

export const ASSET_ARTIFACT_KEYS = [
  ...ASSET_MODULE_KEYS.map((key) => `module_${key}`),
  'raw_data_xlsx',
  'final_bundle',
] as const

export async function scanAssetFiles(uploadIds: string[]): Promise<AssetScanResponse> {
  const response = await api.post<AssetScanResponse>('/tools/asset/scan', {
    upload_ids: uploadIds,
  })
  return response.data
}

export async function createAssetJob(scanId: string, clientRequestId: string) {
  const response = await api.post<AssetComparisonJob & { reused?: boolean }>(
    '/tools/asset/jobs',
    { scanId, clientRequestId },
  )
  return response.data
}

export async function getAssetJob(jobId: string): Promise<AssetComparisonJob> {
  const response = await api.get<AssetComparisonJob>(`/tools/asset/jobs/${jobId}`)
  return response.data
}

export async function getAssetDifferences(params: {
  jobId: string
  moduleKey: string
  type: AssetDifferenceType
  query: string
  offset: number
  limit: number
}): Promise<AssetDifferenceDetails> {
  const response = await api.get<AssetDifferenceDetails>(
    `/tools/asset/jobs/${params.jobId}/modules/${params.moduleKey}/differences`,
    {
      params: {
        type: params.type,
        query: params.query,
        offset: params.offset,
        limit: params.limit,
      },
    },
  )
  return response.data
}

export async function updateAssetAnnotations(
  jobId: string,
  expectedRevision: number,
  remarks: Record<string, string>,
  reviews: Record<string, string>,
): Promise<AssetComparisonJob> {
  const response = await api.patch<AssetComparisonJob>(
    `/tools/asset/jobs/${jobId}/annotations`,
    { expectedRevision, remarks, reviews },
  )
  return response.data
}

export async function finalizeAssetJob(jobId: string): Promise<AssetComparisonJob> {
  const response = await api.post<AssetComparisonJob>(`/tools/asset/jobs/${jobId}/finalize`)
  return response.data
}

export async function retryAssetArtifact(jobId: string, artifactKey: string): Promise<AssetComparisonJob> {
  const response = await api.post<AssetComparisonJob>(
    `/tools/asset/jobs/${jobId}/artifacts/${artifactKey}/retry`,
  )
  return response.data
}

export async function cancelAssetJob(jobId: string): Promise<void> {
  await api.delete(`/tools/asset/jobs/${jobId}`)
}
