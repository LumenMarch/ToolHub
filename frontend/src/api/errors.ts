import axios from 'axios'

/** 后端不可达：没有响应，或由网关返回 502/503/504。 */
export function isBackendUnreachable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return true
  if (!error.response || error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') {
    return true
  }
  return [502, 503, 504].includes(error.response.status)
}

/**
 * 读取后端错误文案。
 * FastAPI 的 detail 可能是字符串，也可能是 Pydantic 校验数组。
 */
export function readApiErrorMessage(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    for (const item of detail) {
      const message = (item as { msg?: unknown } | null)?.msg
      if (typeof message === 'string' && message.trim()) {
        return message.replace(/^Value error,\s*/, '')
      }
    }
  }
  return null
}

export function errorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined
}
