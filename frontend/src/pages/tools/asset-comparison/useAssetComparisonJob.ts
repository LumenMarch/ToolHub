import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../api/axios';
import type { AssetComparisonInputs, AssetComparisonJob } from './types';

const STORAGE_KEY = 'asset-comparison-active-job';
const POLLING_STATUSES = new Set([
  'queued',
  'validating',
  'running',
  'finalizing',
  'cancel_requested',
]);

function readError(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const record = error as {
      message?: string;
      response?: { data?: { detail?: string; message?: string } };
    };
    return (
      record.response?.data?.detail
      ?? record.response?.data?.message
      ?? record.message
      ?? String(error)
    );
  }
  return String(error);
}

export function useAssetComparisonJob() {
  const [job, setJob] = useState<AssetComparisonJob | null>(null);
  const [error, setError] = useState('');
  const jobRef = useRef<AssetComparisonJob | null>(null);
  const annotationQueueRef = useRef<Promise<AssetComparisonJob | null>>(
    Promise.resolve(null),
  );

  const updateJob = useCallback((nextJob: AssetComparisonJob | null) => {
    const currentJob = jobRef.current;
    if (
      nextJob
      && currentJob
      && nextJob.jobId === currentJob.jobId
      && (
        nextJob.annotationRevision < currentJob.annotationRevision
        || (
          nextJob.updatedAt
          && currentJob.updatedAt
          && nextJob.updatedAt < currentJob.updatedAt
        )
      )
    ) {
      return;
    }
    jobRef.current = nextJob;
    setJob(nextJob);
    if (nextJob) {
      sessionStorage.setItem(STORAGE_KEY, nextJob.jobId);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refresh = useCallback(async (jobId?: string) => {
    const targetJobId = jobId ?? jobRef.current?.jobId;
    if (!targetJobId) return null;
    try {
      const response = await api.get<AssetComparisonJob>(
        `/tools/asset/jobs/${targetJobId}`,
      );
      setError('');
      updateJob(response.data);
      return response.data;
    } catch (refreshError: unknown) {
      const status = (
        refreshError as { response?: { status?: number } }
      ).response?.status;
      if (status === 404 || status === 410) {
        updateJob(null);
      }
      setError(readError(refreshError));
      return null;
    }
  }, [updateJob]);

  useEffect(() => {
    const storedJobId = sessionStorage.getItem(STORAGE_KEY);
    if (storedJobId) {
      void refresh(storedJobId);
    }
  }, [refresh]);

  useEffect(() => {
    if (!job || !POLLING_STATUSES.has(job.status)) return;
    const timer = window.setTimeout(() => {
      void refresh(job.jobId);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [job, refresh]);

  const start = useCallback(async (inputs: AssetComparisonInputs) => {
    setError('');
    const response = await api.post<AssetComparisonJob>(
      '/tools/asset/jobs',
      {
        ...inputs,
        clientRequestId: crypto.randomUUID(),
      },
    );
    updateJob(response.data);
    return response.data;
  }, [updateJob]);

  const saveAnnotations = useCallback((
    remarks: Record<string, string>,
    reviews: Record<string, string>,
  ) => {
    annotationQueueRef.current = annotationQueueRef.current
      .catch(() => null)
      .then(async () => {
        const currentJob = jobRef.current;
        if (!currentJob) return null;
        try {
          const response = await api.patch<AssetComparisonJob>(
            `/tools/asset/jobs/${currentJob.jobId}/annotations`,
            {
              expectedRevision: currentJob.annotationRevision,
              remarks,
              reviews,
            },
          );
          setError('');
          updateJob(response.data);
          return response.data;
        } catch (saveError: unknown) {
          setError(readError(saveError));
          if (
            (saveError as { response?: { status?: number } }).response?.status
            === 409
          ) {
            await refresh(currentJob.jobId);
          }
          throw saveError;
        }
      });
    return annotationQueueRef.current;
  }, [refresh, updateJob]);

  const finalize = useCallback(async () => {
    const currentJob = jobRef.current;
    if (!currentJob) return null;
    try {
      const response = await api.post<AssetComparisonJob>(
        `/tools/asset/jobs/${currentJob.jobId}/finalize`,
      );
      setError('');
      updateJob(response.data);
      return response.data;
    } catch (finalizeError: unknown) {
      setError(readError(finalizeError));
      throw finalizeError;
    }
  }, [updateJob]);

  const retry = useCallback(async (artifactKey: string) => {
    const currentJob = jobRef.current;
    if (!currentJob) return null;
    try {
      const response = await api.post<AssetComparisonJob>(
        `/tools/asset/jobs/${currentJob.jobId}/artifacts/${artifactKey}/retry`,
      );
      setError('');
      updateJob(response.data);
      return response.data;
    } catch (retryError: unknown) {
      setError(readError(retryError));
      throw retryError;
    }
  }, [updateJob]);

  const cancel = useCallback(async () => {
    const currentJob = jobRef.current;
    if (!currentJob) return null;
    const response = await api.delete<AssetComparisonJob>(
      `/tools/asset/jobs/${currentJob.jobId}`,
    );
    updateJob(response.data);
    return response.data;
  }, [updateJob]);

  const download = useCallback((artifactKey: string) => {
    const downloadUrl = jobRef.current?.artifacts[artifactKey]?.downloadUrl;
    if (!downloadUrl) return;
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  return {
    job,
    error,
    start,
    refresh,
    saveAnnotations,
    finalize,
    retry,
    cancel,
    download,
  };
}
