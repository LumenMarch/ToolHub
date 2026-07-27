import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import api from '../api/axios';
import { AuthContext } from './auth-context';
import type { User } from './auth-context';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
