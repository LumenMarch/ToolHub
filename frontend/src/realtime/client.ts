export type RealtimeEventType =
  | 'job.updated'
  | 'job.terminal'
  | 'tools_meta.updated'
  | 'llm_config.updated'
  | 'permissions.updated'
  | 'session.revoked'
  | 'user.status.updated'
  | 'user.pending'
  | 'pong'

export interface RealtimeEvent {
  type: RealtimeEventType | string
  tool?: string
  job_id?: string
  user_id?: number
  sid?: string
  status?: string
  at?: string
  [key: string]: unknown
}

type Listener = (event: RealtimeEvent) => void
type ConnectionListener = (connected: boolean) => void

const WS_PATH = '/api/v1/realtime/ws'
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const PING_INTERVAL_MS = 25_000
const POLICY_VIOLATION = 1008

class RealtimeClient {
  private socket: WebSocket | null = null
  private listeners = new Set<Listener>()
  private connectionListeners = new Set<ConnectionListener>()
  private reconnectTimer: number | null = null
  private pingTimer: number | null = null
  private backoffMs = INITIAL_BACKOFF_MS
  private shouldRun = false

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener)
    listener(this.isConnected())
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  start(): void {
    if (this.shouldRun) return
    this.shouldRun = true
    this.backoffMs = INITIAL_BACKOFF_MS
    this.connect()
  }

  stop(): void {
    this.shouldRun = false
    this.clearReconnect()
    this.clearPing()
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    }
    this.emitConnection(false)
  }

  resume(): void {
    if (this.shouldRun) return
    this.shouldRun = true
    this.scheduleReconnect()
  }

  private emitConnection(connected: boolean): void {
    for (const listener of this.connectionListeners) listener(connected)
  }

  private connect(): void {
    if (!this.shouldRun) return
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}${WS_PATH}`)
    this.socket = socket

    socket.onopen = () => {
      if (this.socket !== socket) return
      this.emitConnection(true)
      this.startPing()
    }

    socket.onmessage = (message) => {
      if (this.socket !== socket) return
      this.backoffMs = INITIAL_BACKOFF_MS
      let event: RealtimeEvent
      try {
        event = JSON.parse(String(message.data)) as RealtimeEvent
      } catch {
        return
      }
      if (!event || typeof event.type !== 'string' || event.type === 'pong') return
      for (const listener of [...this.listeners]) {
        try {
          listener(event)
        } catch {
          // 单个订阅方异常不影响其它订阅
        }
      }
    }

    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.clearPing()
      this.emitConnection(false)
      if (!this.shouldRun) return
      if (event.code === POLICY_VIOLATION) {
        this.shouldRun = false
        this.clearReconnect()
        void this.probeAndResume()
        return
      }
      this.scheduleReconnect()
    }
  }

  private async probeAndResume(): Promise<void> {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch('/api/v1/users/me', {
        credentials: 'include',
        signal: controller.signal,
      })
      if (response.ok) {
        this.resume()
      } else if (response.status === 401) {
        window.dispatchEvent(new Event('auth:unauthorized'))
      }
    } catch {
      this.resume()
    } finally {
      window.clearTimeout(timer)
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect()
    if (!this.shouldRun) return
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === null) return
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private startPing(): void {
    this.clearPing()
    this.pingTimer = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send('ping')
    }, PING_INTERVAL_MS)
  }

  private clearPing(): void {
    if (this.pingTimer === null) return
    window.clearInterval(this.pingTimer)
    this.pingTimer = null
  }
}

export const realtimeClient = new RealtimeClient()
