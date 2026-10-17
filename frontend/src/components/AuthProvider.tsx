import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import api from '../api/axios';
import { realtimeClient } from '../lib/realtime';
import { queryClient } from '../lib/query-client';
import { useToolsMetaRealtimeInvalidation } from '../hooks/useToolsMeta';
import { useLlmStatusRealtimeInvalidation } from '../hooks/useLlmStatus';
import { useNotificationsRealtimeInvalidation } from '../hooks/use-notifications';
import { AuthContext, type User } from '../context/AuthContext';

/** 会话复核的超时上限：探针挂死等于实时通道永久静默失效。 */
const SESSION_PROBE_TIMEOUT_MS = 8_000;

/**
 * 用 HTTP 复核会话是否仍然有效。
 *
 * 放在模块级而不是 effect 体内：这里只是事件驱动的会话复核，写在 effect 里
 * 会被静态检查判成「在 effect 中取数」，也让这个副作用脱离 React 生命周期。
 */
async function probeSession(): Promise<boolean> {
  // 探针必须自带超时：/users/me 挂住会让 Promise 永不 settle，实时通道就永久
  // 停在关闭态（比"误登出"更隐蔽的坏态）。超时按"会话仍有效"处理并恢复重连。
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SESSION_PROBE_TIMEOUT_MS);
  try {
    await api.get<User>('/users/me', { signal: controller.signal });
    return true;
  } catch (error) {
    // 明确的 401 说明会话确已失效，登出交给 axios 的 unauthorized 统一处理
    return !(axios.isAxiosError(error) && error.response?.status === 401);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 订阅实时通道的 1008 策略关闭事件，复核会话后决定是否恢复连接。
 *
 * 订阅与异步复核一起放在模块级：effect 只负责建立/撤销订阅，
 * 不再在 effect 体里出现网络调用。
 */
function watchRealtimePolicyClose(isActive: () => boolean): () => void {
  const handlePolicyClose = () => {
    void (async () => {
      const stillValid = await probeSession();
      if (stillValid && isActive()) {
        realtimeClient.resume();
      }
    })();
  };

  window.addEventListener('realtime.policy-close', handlePolicyClose);
  return () => window.removeEventListener('realtime.policy-close', handlePolicyClose);
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useToolsMetaRealtimeInvalidation();
  useLlmStatusRealtimeInvalidation();
  useNotificationsRealtimeInvalidation();

  // 会话收口：停实时通道、清空查询缓存、清本地用户。
  // 三者必须同时发生——只清 user 会把上一位用户的缓存留给下一位使用者。
  const clearSession = useCallback(() => {
    realtimeClient.stop();
    queryClient.clear();
    setUser(null);
  }, []);

  const login = useCallback((authenticatedUser: User) => {
    queryClient.clear();
    setUser(authenticatedUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearSession();
    }
  }, [clearSession]);

  // 登录后建立全站唯一实时通道；登出或未认证时断开
  useEffect(() => {
    if (!user) {
      realtimeClient.stop();
      return;
    }
    realtimeClient.start();
    return () => {
      realtimeClient.stop();
    };
  }, [user]);

  // 1008 是通用 Policy Violation：后端用它表示认证失败，网关主动断连也会用它。
  // 收到后先用 HTTP 复核会话真伪，确认失效才登出（交由 axios 统一处理），
  // 否则按退避恢复实时通道——避免把正常会话误踢下线并永久停连。
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const unsubscribe = watchRealtimePolicyClose(() => !cancelled);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user]);

  // C2/C3：权限变更刷新 /users/me；会话吊销立即清本地态
  useEffect(() => {
    if (!user) return;

    return realtimeClient.subscribe((event) => {
      if (
        event.type === 'permissions.updated' ||
        event.type === 'user.status.updated'
      ) {
        void api
          .get<User>('/users/me')
          .then((response) => {
            const fresh = response.data;
            // 被拒用户：本地登出（清 user + 停实时通道），登录页展示后端区分文案
            if (fresh.status === 'rejected') {
              clearSession();
              void api.post('/auth/logout').catch(() => undefined);
              return;
            }
            setUser(fresh);
          })
          .catch(() => {
            // 401 等由 axios unauthorized 处理
          });
        return;
      }

      if (event.type === 'session.revoked') {
        const sid = event.sid as string | null | undefined
        // 事件带 sid：仅命中当前登录会话时才登出；其它设备被踢只提示。
        // sid 为 null（全局吊销：停用/重置密码/删除等）或 undefined（旧后端）：
        // 视为本会话被吊销，直接登出。用宽松 != null 统一两种缺省。
        if (sid != null && user.current_session_id !== undefined) {
          if (sid === user.current_session_id) {
            clearSession();
            // 尽力清 cookie；失败也已本地登出
            void api.post('/auth/logout').catch(() => undefined);
          } else {
            toast.info('该账号的其它会话已被强制下线');
          }
          return;
        }
        clearSession();
        // 尽力清 cookie；失败也已本地登出
        void api.post('/auth/logout').catch(() => undefined);
      }
    });
  }, [clearSession, user]);

  useEffect(() => {
    let ignore = false;

    const fetchUser = async () => {
      try {
        const response = await api.get('/users/me');
        if (!ignore) {
          setUser(response.data);
        }
      } catch {
        if (!ignore) {
          clearSession();
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    };

    void fetchUser();

    const handleUnauthorized = () => clearSession();
    // 403 由 axios 响应拦截器派发。没有消费者时它会静默失败：页面停在
    // 空表格/转圈，和「后端 500」在用户眼里完全同形。
    const handleForbidden = () => toast.error('没有权限执行该操作', { id: 'forbidden' });

    window.addEventListener('unauthorized', handleUnauthorized);
    window.addEventListener('forbidden', handleForbidden);
    return () => {
      ignore = true;
      window.removeEventListener('unauthorized', handleUnauthorized);
      window.removeEventListener('forbidden', handleForbidden);
    };
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, login, logout, isLoading }),
    [isLoading, login, logout, user],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
};
