import { createContext } from 'react';

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
