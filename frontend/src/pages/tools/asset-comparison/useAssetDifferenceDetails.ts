import { useEffect, useState } from 'react';
import api from '../../../api/axios';
import type {
  DifferenceDetails,
  DifferenceType,
} from './types';

const PAGE_SIZE = 40;

function readError(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const record = error as {
      message?: string;
      response?: { data?: { detail?: string } };
    };
    return record.response?.data?.detail ?? record.message ?? String(error);
  }
  return String(error);
}

export function useAssetDifferenceDetails({
  jobId,
  moduleKey,
  type,
  query,
  page,
  enabled,
}: {
  jobId?: string;
  moduleKey?: string;
  type: DifferenceType;
  query: string;
  page: number;
  enabled: boolean;
}) {
  const [data, setData] = useState<DifferenceDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!enabled || !jobId || !moduleKey) {
      setData(null);
      setError('');
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setData(null);
    setError('');
    void api.get<DifferenceDetails>(
      `/tools/asset/jobs/${jobId}/modules/${moduleKey}/differences`,
      {
        params: {
          type,
          query: debouncedQuery,
          offset: page * PAGE_SIZE,
          limit: PAGE_SIZE,
        },
        signal: controller.signal,
      },
    ).then((response) => {
      setData(response.data);
    }).catch((requestError: unknown) => {
      if ((requestError as { code?: string }).code !== 'ERR_CANCELED') {
        setError(readError(requestError));
      }
    }).finally(() => {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    });

    return () => controller.abort();
  }, [
    debouncedQuery,
    enabled,
    jobId,
    moduleKey,
    page,
    type,
  ]);

  return {
    data,
    error,
    isLoading,
    pageSize: PAGE_SIZE,
  };
}
