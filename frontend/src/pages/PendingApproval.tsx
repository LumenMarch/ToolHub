import React, { useContext } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * 待审批提示页：注册后状态为 pending 的用户只能看到此页，
 * 审批通过后（WS user.status.updated 触发 /users/me 刷新）自动跳回主站。
 */
const PendingApproval: React.FC = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  // 审批完成：approved → 主站；rejected → 登录页（后端登录会返回区分文案）
  if (user?.status === 'approved') {
    return <Navigate to="/" replace />;
  }
  if (user?.status === 'rejected') {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col relative">
      <div className="grain-overlay" />

      <div className="absolute top-8 right-8 z-50 pointer-events-auto">
        <ThemeToggle />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-8 relative z-10">
        <div className="max-w-xl w-full border border-border p-8 md:p-12 space-y-6">
          <p className="text-[11px] font-mono uppercase tracking-widest text-primary">
            [ 注册审批 · 审核中 ]
          </p>
          <h1 className="text-3xl font-bold leading-tight tracking-tight md:text-4xl">
            账号待审批
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            你好，<span className="font-mono text-foreground">{user?.username}</span>
            。你的注册申请已提交，正在等待管理员审批。
            <br />
            审批通过后本页面将自动跳转；如有疑问请联系管理员。
          </p>
          <div className="pt-2 flex items-center gap-6">
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="group relative inline-flex h-9 items-center overflow-hidden whitespace-nowrap px-1 text-[0.8125rem] font-mono uppercase tracking-widest transition-colors hover:text-primary active:translate-y-px"
            >
              <span className="relative z-10">退出登录</span>
              <div className="absolute bottom-0 left-0 w-full h-[1px] bg-primary -translate-x-[101%] group-hover:translate-x-0 transition-transform duration-500 ease-out" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PendingApproval;
