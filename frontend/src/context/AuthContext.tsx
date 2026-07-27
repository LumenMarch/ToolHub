import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import api from '../api/axios';
import { AuthContext } from './auth-context';
import type { User } from './auth-context';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('token'),
  );
  const [isLoading, setIsLoading] = useState(true);

  const login = useCallback((newToken: string) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    let ignore = false;

    const fetchUser = async () => {
      if (token) {
        try {
          const response = await api.get('/users/me');
          if (!ignore) {
            setUser(response.data);
          }
        } catch (error) {
          if (!ignore) {
            console.error('Failed to fetch user', error);
            logout();
          }
        }
      }
      if (!ignore) {
        setIsLoading(false);
      }
    };

    void fetchUser();

    const handleUnauthorized = () => logout();

    window.addEventListener('unauthorized', handleUnauthorized);
    return () => {
      ignore = true;
      window.removeEventListener('unauthorized', handleUnauthorized);
    };
  }, [logout, token]);

  const value = useMemo(
    () => ({ user, token, login, logout, isLoading }),
    [isLoading, login, logout, token, user],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
};
