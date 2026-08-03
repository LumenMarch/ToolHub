import { useRef, useState, useCallback } from 'react';
import * as tus from 'tus-js-client';
import api from '../api/axios';
import { calculateFileDigest } from '../lib/fileDigest';

interface UseTusUploadOptions {
  /** tus 服务端点，默认 /api/v1/upload/tus */
  endpoint?: string;
  /** 分块大小，默认 5MB */
  chunkSize?: number;
  /** 上传进度回调 */
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
  /** 分块被服务端确认回调 */
  onChunkComplete?: (
    chunkSize: number,
    bytesAccepted: number,
    bytesTotal: number,
  ) => void;
  /** 上传成功回调 */
  onSuccess?: (uploadId: string) => void;
  /** 上传失败回调 */
  onError?: (error: Error) => void;
}

export type UploadStatus =
  | 'idle'
  | 'hashing'
  | 'cache-checking'
  | 'uploading'
  | 'confirming'
  | 'completed'
  | 'error'
  | 'aborted';

export interface UploadState {
  status: UploadStatus;
  uploadId: string | null;
  progress: number; // 0-100
  acceptedProgress: number; // 0-100
  bytesSent: number;
  bytesAccepted: number;
  bytesTotal: number;
  cacheHit: boolean;
  error: string | null;
}

interface UploadFileOptions {
  file: File;
  /** 附加元数据，会随 tus 请求提交 */
  metadata?: Record<string, string>;
  /** 当前文件上传进度回调 */
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
  /** 当前文件分块被服务端确认回调 */
  onChunkComplete?: (
    chunkSize: number,
    bytesAccepted: number,
    bytesTotal: number,
  ) => void;
}

const DEFAULT_ENDPOINT = '/api/v1/upload/tus';
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

const createInitialState = (): UploadState => ({
  status: 'idle',
  uploadId: null,
  progress: 0,
  acceptedProgress: 0,
  bytesSent: 0,
  bytesAccepted: 0,
  bytesTotal: 0,
  cacheHit: false,
  error: null,
});

/**
 * 共享 tus 上传 hook。
 * 封装 tus-js-client，提供可取消、带进度、可重置的文件上传能力。
 */
export function useTusUpload(options: UseTusUploadOptions = {}) {
  const {
    endpoint = DEFAULT_ENDPOINT,
    chunkSize = DEFAULT_CHUNK_SIZE,
    onProgress,
    onChunkComplete,
    onSuccess,
    onError,
  } = options;

  const [state, setState] = useState<UploadState>(createInitialState);

  const uploadRefs = useRef<Set<tus.Upload> | null>(null);
  if (uploadRefs.current === null) {
    uploadRefs.current = new Set<tus.Upload>();
  }
  const uploads = uploadRefs.current;

  const abortControllers = useRef<Set<AbortController> | null>(null);
  if (abortControllers.current === null) {
    abortControllers.current = new Set<AbortController>();
  }
  const aborts = abortControllers.current;

  const upload = useCallback(
    ({
      file,
      metadata,
      onProgress: onFileProgress,
      onChunkComplete: onFileChunkComplete,
    }: UploadFileOptions): Promise<string> => {
      const run = async (): Promise<string> => {
        const controller = new AbortController();
        const filename = metadata?.filename || file.name;
        aborts.add(controller);
        setState({
          ...createInitialState(),
          status: 'hashing',
          bytesTotal: file.size,
        });

        try {
          const digest = await calculateFileDigest(file, {
            signal: controller.signal,
            onProgress(bytesHashed, bytesTotal) {
              const progress = Math.min(
                100,
                Math.floor((bytesHashed / bytesTotal) * 100),
              );
              setState((prev) => ({ ...prev, progress }));
            },
          });
          setState((prev) => ({
            ...prev,
            status: 'cache-checking',
            progress: 100,
          }));

          const cacheEndpoint = endpoint.replace(/\/tus\/?$/, '/cache/resolve');
          const cacheResponse = await api.post<{
            cache_hit: boolean;
            upload_id: string | null;
          }>(
            cacheEndpoint.replace(/^\/api\/v1/, ''),
            {
              filename,
              content_type: file.type || 'application/octet-stream',
              ...digest,
            },
            { signal: controller.signal },
          );
          if (cacheResponse.data.cache_hit && cacheResponse.data.upload_id) {
            const uploadId = cacheResponse.data.upload_id;
            setState({
              status: 'completed',
              uploadId,
              progress: 100,
              acceptedProgress: 100,
              bytesSent: file.size,
              bytesAccepted: file.size,
              bytesTotal: file.size,
              cacheHit: true,
              error: null,
            });
            onSuccess?.(uploadId);
            return uploadId;
          }

          setState((prev) => ({
            ...prev,
            status: 'uploading',
            progress: 0,
          }));
          return await new Promise<string>((resolve, reject) => {
            const uploadInstance = new tus.Upload(file, {
              endpoint,
              chunkSize,
              metadata: {
                ...(metadata ?? {}),
                content_type: file.type || 'application/octet-stream',
                md5: digest.md5,
                sha256: digest.sha256,
              },
              onProgress(bytesUploaded, bytesTotal) {
                const pct =
                  bytesTotal > 0
                    ? Math.min(
                        100,
                        Math.floor((bytesUploaded / bytesTotal) * 100),
                      )
                    : 0;
                setState((prev) => ({
                  ...prev,
                  status:
                    bytesTotal > 0 && bytesUploaded >= bytesTotal
                      ? 'confirming'
                      : 'uploading',
                  progress: pct,
                  bytesSent: bytesUploaded,
                  bytesTotal,
                }));
                onProgress?.(bytesUploaded, bytesTotal);
                onFileProgress?.(bytesUploaded, bytesTotal);
              },
              onChunkComplete(chunkBytes, bytesAccepted, bytesTotal) {
                const acceptedPct =
                  bytesTotal > 0
                    ? Math.min(
                        100,
                        Math.floor((bytesAccepted / bytesTotal) * 100),
                      )
                    : 0;
                setState((prev) => ({
                  ...prev,
                  status:
                    bytesTotal > 0 && bytesAccepted >= bytesTotal
                      ? 'confirming'
                      : prev.status,
                  acceptedProgress: acceptedPct,
                  bytesAccepted,
                  bytesTotal,
                }));
                onChunkComplete?.(chunkBytes, bytesAccepted, bytesTotal);
                onFileChunkComplete?.(chunkBytes, bytesAccepted, bytesTotal);
              },
              onSuccess(payload) {
                const url =
                  uploadInstance.url
                  || payload?.lastResponse?.getHeader('Location')
                  || '';
                const uploadId =
                  url.split('?')[0].split('/').filter(Boolean).pop() ?? '';
                setState({
                  status: 'completed',
                  uploadId,
                  progress: 100,
                  acceptedProgress: 100,
                  bytesSent: file.size,
                  bytesAccepted: file.size,
                  bytesTotal: file.size,
                  cacheHit: false,
                  error: null,
                });
                uploads.delete(uploadInstance);
                onSuccess?.(uploadId);
                resolve(uploadId);
              },
              onError(err) {
                uploads.delete(uploadInstance);
                reject(err);
              },
              // 关键：允许凭据（Cookie）随请求发送
              headers: {
                'X-Requested-With': 'XMLHttpRequest',
              },
              // 移除断点续传指纹存储 —— 我们的场景不需要
              storeFingerprintForResuming: false,
            });

            uploads.add(uploadInstance);
            uploadInstance.start();
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          const normalizedError =
            error instanceof Error ? error : new Error(message);
          setState((prev) => ({
            ...prev,
            status: 'error',
            uploadId: null,
            error: message,
          }));
          onError?.(normalizedError);
          throw normalizedError;
        } finally {
          aborts.delete(controller);
        }
      };

      return run();
    },
    [
      aborts,
      endpoint,
      chunkSize,
      onProgress,
      onChunkComplete,
      onSuccess,
      onError,
      uploads,
    ],
  );

  const abort = useCallback(() => {
    for (const uploadInstance of uploads) {
      void uploadInstance.abort(true);
    }
    uploads.clear();
    for (const controller of aborts) {
      controller.abort();
    }
    aborts.clear();
    setState({ ...createInitialState(), status: 'aborted' });
  }, [aborts, uploads]);

  const reset = useCallback(() => {
    uploads.clear();
    aborts.clear();
    setState(createInitialState());
  }, [aborts, uploads]);

  return { ...state, upload, abort, reset };
}
