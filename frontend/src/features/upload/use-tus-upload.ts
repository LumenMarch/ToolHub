import { useCallback, useEffect, useRef, useState } from 'react'
import * as tus from 'tus-js-client'
import { api } from '../../api/client'
import { calculateFileDigest } from './file-digest'

const ENDPOINT = '/api/v1/upload/tus'
const CHUNK_SIZE = 5 * 1024 * 1024
const STALL_TIMEOUT_MS = 60_000
const STALL_CHECK_INTERVAL_MS = 5_000

export type TusPhase =
  | 'idle'
  | 'hashing'
  | 'cache-checking'
  | 'uploading'
  | 'confirming'
  | 'completed'
  | 'error'
  | 'aborted'

export interface TusUploadState {
  phase: TusPhase
  progress: number
  uploadId: string | null
  cacheHit: boolean
  error: string | null
}

const INITIAL_STATE: TusUploadState = {
  phase: 'idle',
  progress: 0,
  uploadId: null,
  cacheHit: false,
  error: null,
}

function uploadIdFromUrl(url: string): string {
  return url.split('?')[0].split('/').filter(Boolean).pop() ?? ''
}

export function useTusUpload() {
  const [state, setState] = useState<TusUploadState>(INITIAL_STATE)
  const abortRef = useRef<AbortController | null>(null)
  const activeUploadRef = useRef<tus.Upload | null>(null)
  const watchdogRef = useRef<number | null>(null)

  const stopWatchdog = () => {
    if (watchdogRef.current !== null) {
      window.clearInterval(watchdogRef.current)
      watchdogRef.current = null
    }
  }

  const abort = useCallback(() => {
    abortRef.current?.abort()
    activeUploadRef.current?.abort(true).catch(() => undefined)
    activeUploadRef.current = null
    stopWatchdog()
    setState((previous) => ({ ...previous, phase: 'aborted' }))
  }, [])

  const reset = useCallback(() => {
    abortRef.current = null
    activeUploadRef.current = null
    stopWatchdog()
    setState(INITIAL_STATE)
  }, [])

  useEffect(() => () => {
    abortRef.current?.abort()
    activeUploadRef.current?.abort(true).catch(() => undefined)
    stopWatchdog()
  }, [])

  const upload = useCallback(async (file: File): Promise<string> => {
    const controller = new AbortController()
    abortRef.current = controller
    setState({ ...INITIAL_STATE, phase: 'hashing' })

    try {
      const digest = await calculateFileDigest(file, {
        signal: controller.signal,
        onProgress: (hashed, total) => {
          const progress = total > 0 ? Math.floor((hashed / total) * 100) : 0
          setState((previous) => ({ ...previous, progress }))
        },
      })

      setState((previous) => ({ ...previous, phase: 'cache-checking', progress: 100 }))
      const cacheResponse = await api.post<{ cache_hit: boolean; upload_id: string | null }>(
        '/upload/cache/resolve',
        {
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          size: digest.size,
          md5: digest.md5,
          sha256: digest.sha256,
        },
        { signal: controller.signal },
      )

      if (cacheResponse.data.cache_hit && cacheResponse.data.upload_id) {
        setState({
          phase: 'completed',
          progress: 100,
          uploadId: cacheResponse.data.upload_id,
          cacheHit: true,
          error: null,
        })
        return cacheResponse.data.upload_id
      }

      setState((previous) => ({ ...previous, phase: 'uploading', progress: 0 }))

      return await new Promise<string>((resolve, reject) => {
        let lastTick = Date.now()
        const instance = new tus.Upload(file, {
          endpoint: ENDPOINT,
          chunkSize: CHUNK_SIZE,
          retryDelays: [0, 1000, 3000, 5000],
          storeFingerprintForResuming: false,
          metadata: {
            filename: file.name,
            content_type: file.type || 'application/octet-stream',
            md5: digest.md5,
            sha256: digest.sha256,
          },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          onProgress: (sent, total) => {
            lastTick = Date.now()
            const progress = total > 0 ? Math.min(100, Math.floor((sent / total) * 100)) : 0
            setState((previous) => ({
              ...previous,
              phase: sent >= total ? 'confirming' : 'uploading',
              progress,
            }))
          },
          onSuccess: () => {
            stopWatchdog()
            const uploadId = instance.url ? uploadIdFromUrl(instance.url) : ''
            activeUploadRef.current = null
            setState({
              phase: 'completed',
              progress: 100,
              uploadId,
              cacheHit: false,
              error: null,
            })
            if (uploadId) resolve(uploadId)
            else reject(new Error('上传完成但未取得 upload id'))
          },
          onError: (error) => {
            stopWatchdog()
            activeUploadRef.current = null
            reject(error)
          },
        })

        activeUploadRef.current = instance
        watchdogRef.current = window.setInterval(() => {
          if (controller.signal.aborted) return
          if (Date.now() - lastTick <= STALL_TIMEOUT_MS) return
          stopWatchdog()
          void instance.abort(true).catch(() => undefined)
          reject(new Error('上传停滞超过 60 秒，已中止'))
        }, STALL_CHECK_INTERVAL_MS)

        instance.start()
      })
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ ...INITIAL_STATE, phase: 'aborted' })
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      setState({ ...INITIAL_STATE, phase: 'error', error: message })
      throw error instanceof Error ? error : new Error(message)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [])

  return { ...state, upload, abort, reset }
}
