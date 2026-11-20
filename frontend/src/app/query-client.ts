import { QueryClient } from '@tanstack/react-query'
import axios from 'axios'

/**
 * 应用级查询缓存。
 * 登出、会话吊销或切换账号时必须整体清空，避免跨用户数据残留。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined
        if (status !== undefined && status >= 400 && status < 500) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: true,
    },
  },
})
