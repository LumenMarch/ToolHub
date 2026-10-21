import axios from 'axios';

/**
 * 判断请求失败是否表示后端不可达，供登录页提交错误分类使用。
 *
 * 只依据传输层信号（无响应、网络/超时错误、网关 5xx）判定；
 * 业务 4xx（401/403/422 等）说明后端活着，不算不可达。
 */
export function isBackendUnreachable(err: unknown): boolean {
  if (!axios.isAxiosError(err)) {
    // 非 axios 异常（如空响应抛错）对登录探测同样视为不可用
    return true;
  }
  if (!err.response || err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') {
    return true;
  }
  const status = err.response.status;
  // 开发代理/反向代理在上游挂掉时常返回 502/503/504
  return status === 502 || status === 503 || status === 504;
}

/**
 * 从失败响应中取出可直接展示给用户的文案。
 *
 * 后端 detail 有两种形态：
 * - 字符串：HTTPException 的业务错误（如 "Cannot modify a user with higher privileges"）；
 * - 数组：Pydantic 校验错误（[{loc, msg, type}]），取首条 msg 并去掉
 *   "Value error, " 前缀，否则用户会看到整段英文结构体。
 * 都取不到时返回 null，由调用方决定兜底文案。
 */
export function readApiErrorMessage(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;
  const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    for (const item of detail) {
      const msg = (item as { msg?: unknown } | null)?.msg;
      if (typeof msg === 'string' && msg.trim()) {
        return msg.replace(/^Value error,\s*/, '');
      }
    }
  }
  return null;
}
