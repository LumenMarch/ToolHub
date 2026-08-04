import { createContext } from 'react';

export interface User {
  id: number;
  username: string;
  is_active: boolean;
  /** 注册审批状态（后端 /users/me 返回；旧后端无此字段时缺省） */
  status?: 'pending' | 'approved' | 'rejected';
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
