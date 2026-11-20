import { useEffect, useRef, useSyncExternalStore } from 'react'

import { realtimeClient, type RealtimeEvent } from '../lib/realtime'

const JOB_EVENT_TYPES: Record<string, true> = {
  'job.updated': true,
  'job.terminal': true,
}

/** 任务查询键：所有工具共用同一命名空间，事件到达时按 tool + job_id 失效。 */
export function jobQueryKey(tool: string, jobId: string | null) {
  return ['job', tool, jobId] as const
}

const subscribeConnection = (listener: (connected: boolean) => void) =>
  realtimeClient.subscribeConnection(listener)

const getConnectionSnapshot = () => realtimeClient.isConnected()

/** 当前 WebSocket 是否健康；断开时调用方应回退轮询。 */
export function useRealtimeConnection(): boolean {
  return useSyncExternalStore(
    subscribeConnection,
    getConnectionSnapshot,
    () => false,
  )
}

type JobIdInput =
  | string
  | null
  | undefined
  | ReadonlyArray<string | null | undefined>

function normalizeJobIds(input: JobIdInput): string[] {
  const values = Array.isArray(input) ? input : [input]
  return Array.from(
    new Set(
      values.filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      ),
    ),
  )
}

/**
 * 订阅指定工具的任务事件。
 *
 * 事件只携带 tool + job_id + status，调用方收到后自行 invalidate / 拉取；
 * 回调放在 ref 中，调用方无需为内联函数做 memo。
 */
export function useJobRealtime(
  tool: string,
  jobIds: JobIdInput,
  onEvent: (event: RealtimeEvent) => void,
): void {
  const key = normalizeJobIds(jobIds).join('|')
  const handlerRef = useRef(onEvent)

  useEffect(() => {
    handlerRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!key) return
    const ids = new Set(key.split('|'))
    return realtimeClient.subscribe((event) => {
      if (!JOB_EVENT_TYPES[event.type]) return
      if (event.tool !== tool) return
      const jobId = event.job_id
      if (typeof jobId !== 'string' || !ids.has(jobId)) return
      handlerRef.current(event)
    })
  }, [key, tool])
}
