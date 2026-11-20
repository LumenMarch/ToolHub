import axios from 'axios'

/**
 * 统一 API 客户端。
 * 认证完全依赖同源 HttpOnly Cookie，前端不保存 token。
 */
export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    if (status === 401) {
      window.dispatchEvent(new Event('auth:unauthorized'))
    }
    if (status === 403) {
      window.dispatchEvent(new Event('auth:forbidden'))
    }
    return Promise.reject(error)
  },
)
