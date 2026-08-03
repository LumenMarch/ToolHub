/**
 * 登录后单一 WebSocket 实时通道。
 * 事件仅作通知：收到后由订阅方再 REST 拉取详情。
 */

export type RealtimeEventType =
  | 'job.updated'
  | 'job.terminal'
  | 'tools_meta.updated'
  | 'pong';

export interface RealtimeEvent {
  type: RealtimeEventType | string;
  job_id?: string;
  user_id?: number;
  status?: string;
  at?: string;
  [key: string]: unknown;
}

export type RealtimeListener = (event: RealtimeEvent) => void;

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed';

const WS_PATH = '/api/v1/realtime/ws';
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const PING_INTERVAL_MS = 25000;

function buildWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${WS_PATH}`;
}

class RealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<RealtimeListener>();
  private stateListeners = new Set<(connected: boolean) => void>();
  private shouldRun = false;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private state: ConnectionState = 'idle';

  /** 当前连接是否健康（open）。 */
  isConnected(): boolean {
    return this.state === 'open' && this.socket?.readyState === WebSocket.OPEN;
  }

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 订阅连接状态（true=已连接，false=断开/重连中）。 */
  subscribeConnection(listener: (connected: boolean) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.isConnected());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** 用户登录后启动；登出时 stop。 */
  start(): void {
    if (this.shouldRun) return;
    this.shouldRun = true;
    this.backoffMs = INITIAL_BACKOFF_MS;
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    this.clearReconnect();
    this.clearPing();
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      try {
        this.socket.close();
      } catch {
        // 忽略关闭异常
      }
      this.socket = null;
    }
    this.setState('closed');
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    const connected = next === 'open';
    for (const listener of this.stateListeners) {
      listener(connected);
    }
  }

  private connect(): void {
    if (!this.shouldRun) return;
    if (
      this.socket
      && (this.socket.readyState === WebSocket.OPEN
        || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.setState('connecting');
    let socket: WebSocket;
    try {
      // 同源 + Cookie：浏览器自动携带 toolhub_session
      socket = new WebSocket(buildWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.setState('open');
      this.startPing();
    };

    socket.onmessage = (message) => {
      if (this.socket !== socket) return;
      let event: RealtimeEvent;
      try {
        event = JSON.parse(String(message.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (!event || typeof event.type !== 'string') return;
      if (event.type === 'pong') return;
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // 订阅方异常不影响其它监听
        }
      }
    };

    socket.onerror = () => {
      // onclose 会处理重连
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearPing();
      this.setState('closed');
      if (this.shouldRun) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    if (!this.shouldRun) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        try {
          this.socket.send('ping');
        } catch {
          // 发送失败等待 onclose
        }
      }
    }, PING_INTERVAL_MS);
  }

  private clearPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

/** 应用级单例：登录后一条连接，全站共享。 */
export const realtimeClient = new RealtimeClient();
