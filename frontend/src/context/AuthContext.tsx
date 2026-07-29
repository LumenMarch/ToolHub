import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import api from '../api/axios';

export interface User {
  id: number;
  username: string;
  is_active: boolean;
  roles: string[];
  permissions: string[];
}

export interface AuthContextValue {
  user: User | null;
  login: (user: User) => void;
  logout: () => Promise<void>;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  login: () => {},
  logout: async () => {},
  isLoading: true,
});
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
