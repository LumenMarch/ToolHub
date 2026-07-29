import { useRef, useState, useCallback } from 'react';
import * as tus from 'tus-js-client';

interface UseTusUploadOptions {
  /** tus 服务端点，默认 /api/v1/upload/tus */
  endpoint?: string;
  /** 分块大小，默认 5MB */
  chunkSize?: number;
  /** 上传进度回调 */
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
  /** 上传成功回调 */
  onSuccess?: (uploadId: string) => void;
  /** 上传失败回调 */
  onError?: (error: Error) => void;
}

interface UploadState {
  status: 'idle' | 'uploading' | 'completed' | 'error' | 'aborted';
  uploadId: string | null;
  progress: number; // 0-100
  error: string | null;
}

interface UploadFileOptions {
  file: File;
  /** 附加元数据，会随 tus 请求提交 */
  metadata?: Record<string, string>;
}

const DEFAULT_ENDPOINT = '/api/v1/upload/tus';
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * 共享 tus 上传 hook。
 * 封装 tus-js-client，提供可取消、带进度、可重置的文件上传能力。
 */
export function useTusUpload(options: UseTusUploadOptions = {}) {
  const {
    endpoint = DEFAULT_ENDPOINT,
    chunkSize = DEFAULT_CHUNK_SIZE,
    onProgress,
    onSuccess,
    onError,
  } = options;

  const [state, setState] = useState<UploadState>({
    status: 'idle',
    uploadId: null,
    progress: 0,
    error: null,
  });

  const uploadRef = useRef<tus.Upload | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const upload = useCallback(
    ({ file, metadata }: UploadFileOptions): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        setState({ status: 'uploading', uploadId: null, progress: 0, error: null });

        const uploadInstance = new tus.Upload(file, {
          endpoint,
          chunkSize,
          metadata: metadata ?? {},
          onProgress(bytesUploaded, bytesTotal) {
            const pct =
              bytesTotal > 0 ? Math.round((bytesUploaded / bytesTotal) * 100) : 0;
            setState((prev) => ({ ...prev, progress: pct }));
            onProgress?.(bytesUploaded, bytesTotal);
          },
          onSuccess(payload) {
            const url =
              uploadInstance.url ||
              payload?.lastResponse?.getHeader('Location') ||
              '';
            const uploadId =
              url.split('?')[0].split('/').filter(Boolean).pop() ?? '';
            setState({
              status: 'completed',
              uploadId,
              progress: 100,
              error: null,
            });
            onSuccess?.(uploadId);
            resolve(uploadId);
          },
          onError(err) {
            const message = err instanceof Error ? err.message : String(err);
            setState({
              status: 'error',
              uploadId: null,
              progress: state.progress,
              error: message,
            });
            onError?.(err instanceof Error ? err : new Error(message));
            reject(err);
          },
          // 关键：允许凭据（Cookie）随请求发送
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
          },
          // 移除断点续传指纹存储 —— 我们的场景不需要
          storeFingerprintForResuming: false,
        });

        uploadRef.current = uploadInstance;

        // 启动上传
        uploadInstance.start();
      });
    },
    [endpoint, chunkSize, onProgress, onSuccess, onError, state.progress],
  );

  const abort = useCallback(() => {
    if (uploadRef.current) {
      uploadRef.current.abort(true);
      uploadRef.current = null;
    }
    abortRef.current?.abort();
    setState({ status: 'aborted', uploadId: null, progress: 0, error: null });
  }, []);

  const reset = useCallback(() => {
    uploadRef.current = null;
    setState({ status: 'idle', uploadId: null, progress: 0, error: null });
  }, []);

  return { ...state, upload, abort, reset };
}
