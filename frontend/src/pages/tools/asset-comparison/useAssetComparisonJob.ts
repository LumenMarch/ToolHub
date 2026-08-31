import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../api/axios';
import { realtimeClient } from '../../../lib/realtime';
import type { AssetComparisonJob } from './types';

const STORAGE_KEY = 'asset-comparison-active-job';
const POLLING_STATUSES = new Set([
  'queued',
  'validating',
  'running',
  'finalizing',
  'cancel_requested',
]);

export function createClientRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(
      bytes,
      byte => byte.toString(16).padStart(2, '0'),
    ).join('');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  }
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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

function readStatus(error: unknown): number | undefined {
  return (
    error as { response?: { status?: number } }
  ).response?.status;
}

function isRequestCancelled(error: unknown): boolean {
  return (
    error as { code?: string; name?: string }
  ).code === 'ERR_CANCELED'
    || (error as { name?: string }).name === 'CanceledError';
}

export type AnnotationSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useAssetComparisonJob() {
  const [job, setJob] = useState<AssetComparisonJob | null>(null);
  const [error, setError] = useState('');
  const [expiredJobId, setExpiredJobId] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [retryingArtifact, setRetryingArtifact] = useState('');
  const [annotationSaveStatus, setAnnotationSaveStatus] =
    useState<AnnotationSaveStatus>('idle');
  const jobRef = useRef<AssetComparisonJob | null>(null);
  const detachedJobIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const requestControllersRef = useRef(new Set<AbortController>());
  const annotationGenerationRef = useRef(0);
  const annotationQueueRef = useRef<Promise<AssetComparisonJob | null>>(
    Promise.resolve(null),
  );

  const createRequestController = useCallback(() => {
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    return controller;
  }, []);

  const releaseRequestController = useCallback(
    (controller: AbortController) => {
      requestControllersRef.current.delete(controller);
    },
    [],
  );

  const updateJob = useCallback((nextJob: AssetComparisonJob | null) => {
    if (!mountedRef.current) return;
    if (nextJob && detachedJobIdsRef.current.has(nextJob.jobId)) {
      return;
    }
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
      setExpiredJobId('');
      sessionStorage.setItem(STORAGE_KEY, nextJob.jobId);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refresh = useCallback(async (jobId?: string) => {
    const targetJobId = jobId ?? jobRef.current?.jobId;
    if (!targetJobId) return null;
    if (detachedJobIdsRef.current.has(targetJobId)) return null;
    refreshControllerRef.current?.abort();
    const controller = createRequestController();
    refreshControllerRef.current = controller;
    try {
      const response = await api.get<AssetComparisonJob>(
        `/tools/asset/jobs/${targetJobId}`,
        { signal: controller.signal },
      );
      if (mountedRef.current) setError('');
      updateJob(response.data);
      return response.data;
    } catch (refreshError: unknown) {
      if (isRequestCancelled(refreshError)) return null;
      if (detachedJobIdsRef.current.has(targetJobId)) {
        return null;
      }
      const status = readStatus(refreshError);
      if (status === 404 || status === 410) {
        updateJob(null);
        if (status === 410 && mountedRef.current) {
          setExpiredJobId(targetJobId);
        }
      }
      if (mountedRef.current) setError(readError(refreshError));
      return null;
    } finally {
      releaseRequestController(controller);
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
      }
    }
  }, [createRequestController, releaseRequestController, updateJob]);

  useEffect(() => {
    mountedRef.current = true;
    const requestControllers = requestControllersRef.current;
    const storedJobId = sessionStorage.getItem(STORAGE_KEY);
    if (storedJobId) {
      void refresh(storedJobId);
    }
    return () => {
      mountedRef.current = false;
      for (const controller of requestControllers) {
        controller.abort();
      }
      requestControllers.clear();
    };
  }, [refresh]);

  // WS 健康时靠 job.updated/terminal 触发 refresh；断开则恢复 1s 轮询
  const [wsConnected, setWsConnected] = useState(() =>
    realtimeClient.isConnected(),
  );

  useEffect(() => {
    return realtimeClient.subscribeConnection(setWsConnected);
  }, []);

  useEffect(() => {
    return realtimeClient.subscribe((event) => {
      if (event.type !== 'job.updated' && event.type !== 'job.terminal') {
        return;
      }
      const jobId = typeof event.job_id === 'string' ? event.job_id : '';
      if (!jobId) return;
      const activeId = jobRef.current?.jobId;
      const storedId = sessionStorage.getItem(STORAGE_KEY);
      if (jobId !== activeId && jobId !== storedId) return;
      void refresh(jobId);
    });
  }, [refresh]);

  useEffect(() => {
    if (!job || !POLLING_STATUSES.has(job.status)) return;
    if (wsConnected) return;
    const timer = window.setTimeout(() => {
      void refresh(job.jobId);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [job, refresh, wsConnected]);

  const start = useCallback(async (scanId: string) => {
    const controller = createRequestController();
    setError('');
    setExpiredJobId('');
    setIsStarting(true);
    try {
      const response = await api.post<AssetComparisonJob>(
        '/tools/asset/jobs',
        {
          scanId,
          clientRequestId: createClientRequestId(),
        },
        { signal: controller.signal },
      );
      updateJob(response.data);
      return response.data;
    } catch (startError: unknown) {
      if (!isRequestCancelled(startError) && mountedRef.current) {
        setError(readError(startError));
      }
      throw startError;
    } finally {
      releaseRequestController(controller);
      if (mountedRef.current) setIsStarting(false);
    }
  }, [createRequestController, releaseRequestController, updateJob]);

  const saveAnnotations = useCallback((
    remarks: Record<string, string>,
    reviews: Record<string, string>,
  ) => {
    const generation = annotationGenerationRef.current + 1;
    annotationGenerationRef.current = generation;
    setAnnotationSaveStatus('saving');
    annotationQueueRef.current = annotationQueueRef.current
      .catch(() => null)
      .then(async () => {
        if (!mountedRef.current) return null;
        const currentJob = jobRef.current;
        if (!currentJob) return null;
        const controller = createRequestController();
        try {
          const response = await api.patch<AssetComparisonJob>(
            `/tools/asset/jobs/${currentJob.jobId}/annotations`,
            {
              expectedRevision: currentJob.annotationRevision,
              remarks,
              reviews,
            },
            { signal: controller.signal },
          );
          if (mountedRef.current) setError('');
          updateJob(response.data);
          if (
            mountedRef.current
            && annotationGenerationRef.current === generation
          ) {
            setAnnotationSaveStatus('saved');
          }
          return response.data;
        } catch (saveError: unknown) {
          if (isRequestCancelled(saveError)) return null;
          if (detachedJobIdsRef.current.has(currentJob.jobId)) {
            return null;
          }
          if (mountedRef.current) {
            setError(readError(saveError));
            setAnnotationSaveStatus('error');
          }
          if (readStatus(saveError) === 409) {
            await refresh(currentJob.jobId);
          }
          throw saveError;
        } finally {
          releaseRequestController(controller);
        }
      });
    return annotationQueueRef.current;
  }, [
    createRequestController,
    refresh,
    releaseRequestController,
    updateJob,
  ]);

  const finalize = useCallback(async () => {
    const currentJob = jobRef.current;
    if (!currentJob) return null;
    const controller = createRequestController();
    setIsFinalizing(true);
    try {
      const response = await api.post<AssetComparisonJob>(
        `/tools/asset/jobs/${currentJob.jobId}/finalize`,
        undefined,
        { signal: controller.signal },
      );
      if (mountedRef.current) setError('');
      updateJob(response.data);
      return response.data;
    } catch (finalizeError: unknown) {
      if (!isRequestCancelled(finalizeError) && mountedRef.current) {
        setError(readError(finalizeError));
      }
      throw finalizeError;
    } finally {
      releaseRequestController(controller);
      if (mountedRef.current) setIsFinalizing(false);
    }
  }, [createRequestController, releaseRequestController, updateJob]);

  const retry = useCallback(async (artifactKey: string) => {
    const currentJob = jobRef.current;
    if (!currentJob) return null;
    const controller = createRequestController();
    setRetryingArtifact(artifactKey);
    try {
      const response = await api.post<AssetComparisonJob>(
        `/tools/asset/jobs/${currentJob.jobId}/artifacts/${artifactKey}/retry`,
        undefined,
        { signal: controller.signal },
      );
      if (mountedRef.current) setError('');
      updateJob(response.data);
      return response.data;
    } catch (retryError: unknown) {
      if (!isRequestCancelled(retryError) && mountedRef.current) {
        setError(readError(retryError));
      }
      throw retryError;
    } finally {
      releaseRequestController(controller);
      if (mountedRef.current) setRetryingArtifact('');
    }
  }, [createRequestController, releaseRequestController, updateJob]);

  const cancel = useCallback(async () => {
    const currentJob = jobRef.current;
    if (!currentJob) return null;
    const controller = createRequestController();
    setIsCancelling(true);
    try {
      const response = await api.delete<AssetComparisonJob>(
        `/tools/asset/jobs/${currentJob.jobId}`,
        { signal: controller.signal },
      );
      if (mountedRef.current) setError('');
      updateJob(response.data);
      return response.data;
    } catch (cancelError: unknown) {
      if (!isRequestCancelled(cancelError) && mountedRef.current) {
        setError(readError(cancelError));
      }
      throw cancelError;
    } finally {
      releaseRequestController(controller);
      if (mountedRef.current) setIsCancelling(false);
    }
  }, [createRequestController, releaseRequestController, updateJob]);

  const reset = useCallback(async () => {
    const currentJobId = (
      jobRef.current?.jobId
      ?? sessionStorage.getItem(STORAGE_KEY)
    );
    if (currentJobId) {
      try {
        await api.delete(`/tools/asset/jobs/${currentJobId}/purge`);
      } catch (purgeError: unknown) {
        const status = (
          purgeError as { response?: { status?: number } }
        ).response?.status;
        if (status !== 404 && status !== 410) {
          setError(readError(purgeError));
          throw purgeError;
        }
      }
      detachedJobIdsRef.current.add(currentJobId);
    }
    annotationQueueRef.current = Promise.resolve(null);
    annotationGenerationRef.current += 1;
    jobRef.current = null;
    setJob(null);
    setError('');
    setExpiredJobId('');
    setAnnotationSaveStatus('idle');
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

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
    expiredJobId,
    isStarting,
    isFinalizing,
    isCancelling,
    retryingArtifact,
    annotationSaveStatus,
    start,
    refresh,
    saveAnnotations,
    finalize,
    retry,
    cancel,
    reset,
    download,
  };
}
