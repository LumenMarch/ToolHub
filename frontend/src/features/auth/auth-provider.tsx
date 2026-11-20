import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { App as AntApp } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, logoutSession } from '../../api/auth'
import { errorStatus } from '../../api/errors'
import type { User } from '../../api/types'
import { realtimeClient } from '../../realtime/client'
import type { RealtimeEvent } from '../../realtime/client'
import { notificationsQueryKey } from '../notifications/query-keys'
import { toolsMetaQueryKey } from '../dashboard/use-visible-tools'
import { AuthContext } from './auth-context'
import type { AuthContextValue } from './auth-context'

const meQueryKey = ['me'] as const
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClientInstance = useQueryClient()
  const { message } = AntApp.useApp()
  const messageRef = useRef(message)
  const userRef = useRef<User | null>(null)

  useEffect(() => {
    messageRef.current = message
  }, [message])

  const meQuery = useQuery<User | null>({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await getMe()
      } catch (error) {
        // 未登录是正常状态，不作为查询错误处理
        if (errorStatus(error) === 401) return null
        throw error
      }
    },
    retry: false,
    staleTime: 60_000,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 15_000 : false,
  })

  const user = meQuery.data ?? null
  const { isPending, refetch } = meQuery

  useEffect(() => {
    userRef.current = user
  }, [user])

  const login = useCallback(
    (authenticatedUser: User) => {
      // 保留 me 查询的 observer，只清掉上一位用户的服务端数据。
      queryClientInstance.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'me',
      })
      queryClientInstance.setQueryData<User | null>(meQueryKey, authenticatedUser)
    },
    [queryClientInstance],
  )

  const clearSession = useCallback(() => {
    realtimeClient.stop()
    queryClientInstance.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'me',
    })
    queryClientInstance.setQueryData<User | null>(meQueryKey, null)
  }, [queryClientInstance])

  const logout = useCallback(async () => {
    try {
      await logoutSession()
    } finally {
      clearSession()
    }
  }, [clearSession])

  useEffect(() => {
    const handleUnauthorized = () => clearSession()
    const handleForbidden = () =>
      messageRef.current.error({ content: '没有权限执行该操作', key: 'forbidden' })
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    window.addEventListener('auth:forbidden', handleForbidden)
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized)
      window.removeEventListener('auth:forbidden', handleForbidden)
    }
  }, [clearSession])

  useEffect(() => {
    if (user?.status !== 'rejected') return
    void logout()
  }, [logout, user?.status])

  const authenticated = user !== null

  useEffect(() => {
    if (!authenticated) {
      realtimeClient.stop()
      return
    }
    realtimeClient.start()
    return () => realtimeClient.stop()
  }, [authenticated])

  const handleRealtimeEvent = useEffectEvent((event: RealtimeEvent) => {
    const currentUser = userRef.current

    if (event.type === 'permissions.updated' || event.type === 'user.status.updated') {
      void queryClientInstance.invalidateQueries({ queryKey: notificationsQueryKey })
      void queryClientInstance.invalidateQueries({ queryKey: ['admin', 'users'] })
      void refetch()
      return
    }

    if (event.type === 'tools_meta.updated') {
      void queryClientInstance.invalidateQueries({ queryKey: toolsMetaQueryKey })
      return
    }

    if (event.type === 'llm_config.updated') {
      void queryClientInstance.invalidateQueries({ queryKey: ['llm-status'] })
      void queryClientInstance.invalidateQueries({ queryKey: ['llm-availability'] })
      return
    }

    if (event.type === 'job.terminal' || event.type === 'user.pending') {
      void queryClientInstance.invalidateQueries({ queryKey: notificationsQueryKey })
    }

    if (event.type === 'user.pending') {
      void queryClientInstance.invalidateQueries({ queryKey: ['admin', 'users'] })
    }

    if (event.type !== 'session.revoked') return

    const sid = typeof event.sid === 'string' ? event.sid : null
    if (sid && currentUser?.current_session_id && sid !== currentUser.current_session_id) {
      messageRef.current.info('该账号的其它设备已被强制下线')
      return
    }

    clearSession()
    void logoutSession().catch(() => undefined)
  })

  useEffect(() => {
    if (!authenticated) return
    return realtimeClient.subscribe(handleRealtimeEvent)
  }, [authenticated])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading: isPending,
      login,
      logout,
      refresh: refetch,
    }),
    [isPending, login, logout, refetch, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
