/**
 * POST + SSE 的极简消费器。
 *
 * 为什么不用 EventSource：它只能 GET，而模型调用要把统计结构当请求体发过去。
 * 为什么不用 axios：axios 的浏览器适配器拿不到流式 body，只能等整个响应结束，
 * 那样就退化成「一次性返回」，白瞎了服务端的流式。
 *
 * 认证靠 Cookie（axios 实例开了 withCredentials，这里同样带 credentials），
 * 因此不读 localStorage 里的 token。
 */

export interface SseEvent {
  event: string;
  data: string;
}

export interface PostSseOptions {
  body: unknown;
  signal?: AbortSignal;
  onEvent: (event: SseEvent) => void;
}

export async function postSse(path: string, options: PostSseOptions): Promise<void> {
  const { body, signal, onEvent } = options;

  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    // 推流开始前的失败仍然是普通 HTTP 错误（如 400 参数不合法、403 无权限）
    throw new Error(await readHttpError(response));
  }
  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  // SSE 以空行分帧；服务端心跳(ping)也是事件帧，直接忽略
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = normalizeLineEnds(buffer + decoder.decode(value, { stream: true }));
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseFrame(frame);
      if (parsed) onEvent(parsed);
      boundary = buffer.indexOf('\n\n');
    }
  }
  const tail = parseFrame(buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  if (tail) onEvent(tail);
}

/**
 * 把行结束符归一化成 \n。
 *
 * 不归一化就直接坏事：sse-starlette 的 DEFAULT_SEPARATOR 实测是 '\r\n'（v3.4.11），
 * 帧尾是 \r\n\r\n，而按 '\n\n' 找边界永远找不到 —— 整个流不派发任何一个事件，
 * 最后只能把全文当成一个帧解：data 是多个 JSON 拼起来的串，解析必然失败，
 * 界面拿到的是空结论且不带错误，看起来就是“分析完了但什么也没显示”。
 *
 * 结尾单个 \r 先留着：它可能是 CRLF 的前半截，\n 在下个分片里，
 * 提前换行会切出一个假帧边界。流结束时再清掉。
 */
function normalizeLineEnds(raw: string): string {
  const holdBack = raw.endsWith('\r') ? 1 : 0;
  const head = raw.slice(0, raw.length - holdBack);
  return head.replace(/\r\n/g, '\n').replace(/\r/g, '\n') + raw.slice(raw.length - holdBack);
}

function parseFrame(frame: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join('\n') };
}

async function readHttpError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && 'message' in detail) {
      return String((detail as { message: unknown }).message);
    }
  } catch {
    /* 响应体不是 JSON 时退回状态码文案 */
  }
  return `请求失败（HTTP ${response.status}）`;
}
