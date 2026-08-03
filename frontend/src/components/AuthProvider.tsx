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
