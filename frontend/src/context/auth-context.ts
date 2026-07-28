import { createContext } from 'react';

export interface User {
  id: number;
  username: string;
  is_admin: boolean;
  is_active: boolean;
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
