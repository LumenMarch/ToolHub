import { useCallback, useEffect, useRef, useState } from 'react';
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

/** 进度节流窗口：百分比未变且距上次上报不足该时长时跳过，避免大文件下高频 setState。 */
const PROGRESS_MIN_INTERVAL_MS = 100;
/** 无进度看门狗：连接被静默掐断时 tus 不会报错，只会永远停在 uploading。 */
const STALL_TIMEOUT_MS = 60_000;
const STALL_CHECK_INTERVAL_MS = 5_000;
/** 缓存检查超时：这一步挂住会让上传既开始不了也失败不了，界面永远停在「查找缓存」。 */
const CACHE_RESOLVE_TIMEOUT_MS = 30_000;

interface ProgressThrottle {
  percent: number;
  at: number;
}

const shouldReportProgress = (
  percent: number,
  throttle: ProgressThrottle,
): boolean => {
  if (percent === throttle.percent) return false;
  const advanced = percent - throttle.percent >= 1;
  if (
    percent < 100
    && !advanced
    && Date.now() - throttle.at < PROGRESS_MIN_INTERVAL_MS
  ) {
    return false;
  }
  throttle.percent = percent;
  throttle.at = Date.now();
  return true;
};

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

  // 回调放进 ref：调用方普遍传内联箭头函数，直接作为 upload 的依赖会让 upload
  // 每次 render 都重建，上游一旦把 upload 放进 effect 依赖就会重复触发。
  const callbacksRef = useRef({ onProgress, onChunkComplete, onSuccess, onError });
  useEffect(() => {
    callbacksRef.current = { onProgress, onChunkComplete, onSuccess, onError };
  }, [onProgress, onChunkComplete, onSuccess, onError]);

  const hashingThrottleRef = useRef<ProgressThrottle>({ percent: -1, at: 0 });
  const uploadThrottleRef = useRef<ProgressThrottle>({ percent: -1, at: 0 });

  // 活跃看门狗的停止器：reset() 必须能把它们停掉，否则被放弃的上传仍会在
  // 稍后因停滞而 reject，把已经重置干净的状态改回 error
  const watchdogStoppersRef = useRef<Set<() => void> | null>(null);
  if (watchdogStoppersRef.current === null) {
    watchdogStoppersRef.current = new Set<() => void>();
  }
  const watchdogStoppers = watchdogStoppersRef.current;

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
        hashingThrottleRef.current = { percent: -1, at: 0 };
        uploadThrottleRef.current = { percent: -1, at: 0 };
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
              // 1 GiB 文件按 4 MiB 批次回调 256 次，全量 setState 会让主线程抖
              if (!shouldReportProgress(progress, hashingThrottleRef.current)) return;
              setState((prev) => ({ ...prev, progress }));
            },
          });
          setState((prev) => ({
            ...prev,
            status: 'cache-checking',
            progress: 100,
          }));

          const cacheEndpoint = endpoint.replace(/\/tus\/?$/, '/cache/resolve');
          // 独立 controller：既能被超时中断，也能被 abort() 通过 aborts 集合取消
          const resolveCache = async () => {
            const cacheController = new AbortController();
            aborts.add(cacheController);
            let timedOut = false;
            const timer = window.setTimeout(() => {
              timedOut = true;
              cacheController.abort();
            }, CACHE_RESOLVE_TIMEOUT_MS);
            try {
              return await api.post<{
                cache_hit: boolean;
                upload_id: string | null;
              }>(
                cacheEndpoint.replace(/^\/api\/v1/, ''),
                {
                  filename,
                  content_type: file.type || 'application/octet-stream',
                  ...digest,
                },
                { signal: cacheController.signal },
              );
            } catch (error) {
              throw timedOut ? new Error('缓存检查超时，请重试') : error;
            } finally {
              window.clearTimeout(timer);
              aborts.delete(cacheController);
            }
          };
          const cacheResponse = await resolveCache();
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
            callbacksRef.current.onSuccess?.(uploadId);
            return uploadId;
          }

          setState((prev) => ({
            ...prev,
            status: 'uploading',
            progress: 0,
          }));
          return await new Promise<string>((resolve, reject) => {
            let lastTick = Date.now();
            let watchdog: number | null = null;
            const stopWatchdog = () => {
              if (watchdog !== null) {
                window.clearInterval(watchdog);
                watchdog = null;
              }
              watchdogStoppers.delete(stopWatchdog);
            };
            watchdogStoppers.add(stopWatchdog);

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
                lastTick = Date.now();
                const pct =
                  bytesTotal > 0
                    ? Math.min(
                        100,
                        Math.floor((bytesUploaded / bytesTotal) * 100),
                      )
                    : 0;
                const settled = bytesTotal > 0 && bytesUploaded >= bytesTotal;
                // 字节级进度事件极其密集：只节流 setState，终态必须放行
                if (settled || shouldReportProgress(pct, uploadThrottleRef.current)) {
                  setState((prev) => ({
                    ...prev,
                    status: settled ? 'confirming' : 'uploading',
                    progress: pct,
                    bytesSent: bytesUploaded,
                    bytesTotal,
                  }));
                }
                callbacksRef.current.onProgress?.(bytesUploaded, bytesTotal);
                onFileProgress?.(bytesUploaded, bytesTotal);
              },
              onChunkComplete(chunkBytes, bytesAccepted, bytesTotal) {
                lastTick = Date.now();
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
                callbacksRef.current.onChunkComplete?.(
                  chunkBytes,
                  bytesAccepted,
                  bytesTotal,
                );
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
                stopWatchdog();
                uploads.delete(uploadInstance);
                callbacksRef.current.onSuccess?.(uploadId);
                resolve(uploadId);
              },
              onError(err) {
                stopWatchdog();
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
            // 对端静默失联时 tus 既不报错也不超时，这里用无进度看门狗兜底，
            // 避免界面永远停在 uploading 且请求永久 pending。
            watchdog = window.setInterval(() => {
              if (controller.signal.aborted) {
                stopWatchdog();
                return;
              }
              if (Date.now() - lastTick <= STALL_TIMEOUT_MS) return;
              stopWatchdog();
              // 停滞实例必须自己从 uploads 摘掉：abort 之后 tus 不再回调
              // onError/onSuccess，留在集合里会一直持有整个 File
              uploads.delete(uploadInstance);
              // abort 的 rejection 单独吞掉，只上报停滞本身
              void uploadInstance.abort(true).catch(() => undefined);
              reject(new Error('上传停滞超过 60 秒，已中止'));
            }, STALL_CHECK_INTERVAL_MS);
            uploadInstance.start();
          });
        } catch (error) {
          if (controller.signal.aborted) {
            // 取消路径也要收口状态：否则 UI 会同时显示「已取消」和上一次的错误文案
            setState({ ...createInitialState(), status: 'aborted' });
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
          callbacksRef.current.onError?.(normalizedError);
          throw normalizedError;
        } finally {
          aborts.delete(controller);
        }
      };

      return run();
    },
    [aborts, chunkSize, endpoint, uploads, watchdogStoppers],
  );

  const abort = useCallback(() => {
    for (const stop of [...watchdogStoppers]) stop();
    for (const uploadInstance of uploads) {
      void uploadInstance.abort(true).catch(() => undefined);
    }
    uploads.clear();
    for (const controller of aborts) {
      controller.abort();
    }
    aborts.clear();
    setState({ ...createInitialState(), status: 'aborted' });
  }, [aborts, uploads, watchdogStoppers]);

  const reset = useCallback(() => {
    // 先停看门狗：否则被放弃的上传仍可能在稍后因停滞而 reject，
    // 把刚刚重置干净的状态改成 error
    for (const stop of [...watchdogStoppers]) stop();
    uploads.clear();
    aborts.clear();
    setState(createInitialState());
  }, [aborts, uploads, watchdogStoppers]);

  return { ...state, upload, abort, reset };
}
