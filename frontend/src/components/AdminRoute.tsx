import React, { useContext } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { AuthContext } from '../context/auth-context';

const AdminRoute: React.FC = () => {
  const { user, isLoading } = useContext(AuthContext);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center">
        <span className="w-5 h-5 border-[1.5px] border-white/20 border-t-white rounded-full animate-spin"></span>
      </div>
    );
  }

  // 未登录跳登录页，已登录但非管理员回主页。
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!user.is_admin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default AdminRoute;
