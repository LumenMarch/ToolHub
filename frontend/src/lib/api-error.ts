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
