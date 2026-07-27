import { createContext } from 'react';

export interface User {
  id: number;
  username: string;
}

export interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  isLoading: true,
});
