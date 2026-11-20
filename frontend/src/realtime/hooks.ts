import { useEffect, useEffectEvent, useSyncExternalStore } from 'react'
import { realtimeClient, type RealtimeEvent } from './client'

const subscribeConnection = (listener: (connected: boolean) => void) =>
  realtimeClient.subscribeConnection(listener)

export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(
    subscribeConnection,
    () => realtimeClient.isConnected(),
    () => false,
  )
}

export function useRealtimeEvent(
  types: readonly string[],
  listener: (event: RealtimeEvent) => void,
): void {
  const onEvent = useEffectEvent(listener)
  const typeKey = types.join('|')

  useEffect(() => {
    const accepted = new Set(typeKey.split('|'))
    return realtimeClient.subscribe((event) => {
      if (accepted.has(event.type)) onEvent(event)
    })
  }, [typeKey])
}
