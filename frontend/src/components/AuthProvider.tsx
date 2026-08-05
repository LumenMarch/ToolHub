import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import api from '../api/axios';
import { realtimeClient } from '../lib/realtime';
import { useToolsMetaRealtimeInvalidation } from '../hooks/useToolsMeta';
import { AuthContext, type User } from '../context/AuthContext';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useToolsMetaRealtimeInvalidation();

  const login = useCallback((authenticatedUser: User) => {
    setUser(authenticatedUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

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
              realtimeClient.stop();
              setUser(null);
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
        realtimeClient.stop();
        setUser(null);
        // 尽力清 cookie；失败也已本地登出
        void api.post('/auth/logout').catch(() => undefined);
      }
    });
  }, [user]);

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
          setUser(null);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    };

    void fetchUser();

    const handleUnauthorized = () => setUser(null);

    window.addEventListener('unauthorized', handleUnauthorized);
    return () => {
      ignore = true;
      window.removeEventListener('unauthorized', handleUnauthorized);
    };
  }, []);

  const value = useMemo(
    () => ({ user, login, logout, isLoading }),
    [isLoading, login, logout, user],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
};
