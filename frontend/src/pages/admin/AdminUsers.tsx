import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  PencilSimple,
  Plus,
  Trash,
  ShieldCheck,
  ShieldSlash,
  CheckCircle,
  Circle,
} from '@phosphor-icons/react';
import { AuthContext } from '../../context/auth-context';
import { useAdminApi } from '../../hooks/useAdminApi';
import type { AdminUser, UserCreateInput, UserUpdateInput } from '../../hooks/useAdminApi';
import DataTable from '../../components/admin/DataTable';
import type { Column } from '../../components/admin/DataTable';
import Modal from '../../components/admin/Modal';

const AdminUsers: React.FC = () => {
  const api = useAdminApi();
  const { user: currentUser } = useContext(AuthContext);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // 弹窗状态
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const refresh = useCallback(
    (q?: string) => {
      setLoading(true);
      setError('');
      api
        .listUsers(q ? { search: q } : undefined)
        .then(setUsers)
        .catch(() => setError('加载用户列表失败'))
        .finally(() => setLoading(false));
    },
    [api],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 搜索去抖。
  useEffect(() => {
    const timer = setTimeout(() => refresh(search), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleCreate = async (input: UserCreateInput) => {
    await api.createUser(input);
    setCreateOpen(false);
    refresh(search);
  };

  const handleUpdate = async (userId: number, input: UserUpdateInput) => {
    await api.updateUser(userId, input);
    setEditTarget(null);
    refresh(search);
  };

  const handleDelete = async (userId: number) => {
    await api.deleteUser(userId);
    setDeleteTarget(null);
    refresh(search);
  };

  const formatDate = (s: string | null) => {
    if (!s) return '从未';
    const d = new Date(s);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const columns: Column<AdminUser>[] = [
    {
      key: 'username',
      header: '用户名',
      sortable: true,
      sortValue: (u) => u.username,
      render: (u) => <span className="font-mono">{u.username}</span>,
    },
    {
      key: 'is_admin',
      header: '角色',
      sortable: true,
      sortValue: (u) => (u.is_admin ? 1 : 0),
      render: (u) =>
        u.is_admin ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest text-primary">
            <ShieldCheck className="w-3.5 h-3.5" /> 管理员
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            <ShieldSlash className="w-3.5 h-3.5" /> 用户
          </span>
        ),
    },
    {
      key: 'is_active',
      header: '状态',
      sortable: true,
      sortValue: (u) => (u.is_active ? 1 : 0),
      render: (u) =>
        u.is_active ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest">
            <CheckCircle className="w-3.5 h-3.5" /> 活跃
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            <Circle className="w-3.5 h-3.5" /> 已停用
          </span>
        ),
    },
    {
      key: 'created_at',
      header: '创建时间',
      sortable: true,
      sortValue: (u) => u.created_at,
      render: (u) => (
        <span className="text-[11px] font-mono text-muted-foreground">
          {formatDate(u.created_at)}
        </span>
      ),
    },
    {
      key: 'last_login_at',
      header: '上次登录',
      sortable: true,
      sortValue: (u) => u.last_login_at ?? '',
      render: (u) => (
        <span className="text-[11px] font-mono text-muted-foreground">
          {formatDate(u.last_login_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (u) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditTarget(u)}
            className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
            aria-label="编辑用户"
            title="编辑"
          >
            <PencilSimple className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget(u)}
            disabled={currentUser?.id === u.id}
            className="p-1.5 text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="删除用户"
            title={currentUser?.id === u.id ? '不能删除自己' : '删除'}
          >
            <Trash className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          管理系统账号、角色与状态
        </p>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索用户名..."
            className="awwwards-input w-48"
          />
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono uppercase tracking-widest border border-border hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 新建
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm font-mono text-primary bg-primary/10 p-4 border-l-2 border-primary uppercase tracking-widest">
          [ 异常: {error} ]
        </div>
      )}

      <div className="border border-border">
        <DataTable
          columns={columns}
          data={users}
          rowKey={(u) => u.id}
          emptyHint={loading ? '加载中...' : '无匹配用户'}
        />
      </div>

      {/* 新建用户弹窗 */}
      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />

      {/* 编辑用户弹窗 */}
      <EditUserModal
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={(input) => editTarget && handleUpdate(editTarget.id, input)}
        isSelf={!!editTarget && currentUser?.id === editTarget.id}
      />

      {/* 删除确认弹窗 */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="确认删除"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 text-[11px] font-mono uppercase tracking-widest border border-border hover:border-foreground transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
              className="px-4 py-2 text-[11px] font-mono uppercase tracking-widest bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm">
          确定要删除用户{' '}
          <span className="font-mono font-bold text-primary">
            {deleteTarget?.username}
          </span>{' '}
          吗？此操作不可撤销。
        </p>
      </Modal>
    </div>
  );
};

// ===== 新建用户弹窗 =====

interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: UserCreateInput) => Promise<void>;
}

const CreateUserModal: React.FC<CreateUserModalProps> = ({ open, onClose, onSubmit }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setUsername('');
    setPassword('');
    setIsAdmin(false);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('用户名和密码不能为空');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({ username: username.trim(), password, is_admin: isAdmin });
      reset();
    } catch {
      setError('创建失败，用户名可能已存在');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="新建用户"
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-[11px] font-mono uppercase tracking-widest border border-border hover:border-foreground transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            form="create-user-form"
            disabled={submitting}
            className="px-4 py-2 text-[11px] font-mono uppercase tracking-widest bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting ? '创建中...' : '创建'}
          </button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="awwwards-input w-full"
            placeholder=" "
            required
            autoFocus
          />
          <label className="absolute left-0 top-4 text-muted-foreground font-mono text-sm tracking-widest uppercase pointer-events-none transition-[color,font-size,transform] duration-300 [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8 [.awwwards-input:not(:placeholder-shown)~&]:text-[11px] [.awwwards-input:not(:placeholder-shown)~&]:text-primary">
            用户名
          </label>
        </div>
        <div className="relative">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="awwwards-input w-full font-mono tracking-widest"
            placeholder=" "
            required
          />
          <label className="absolute left-0 top-4 text-muted-foreground font-mono text-sm tracking-widest uppercase pointer-events-none transition-[color,font-size,transform] duration-300 [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8 [.awwwards-input:not(:placeholder-shown)~&]:text-[11px] [.awwwards-input:not(:placeholder-shown)~&]:text-primary">
            密码
          </label>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-accent)]"
          />
          <span className="text-sm font-mono uppercase tracking-widest">
            设为管理员
          </span>
        </label>
        {error && (
          <p className="text-[11px] font-mono uppercase tracking-widest text-primary">
            [ {error} ]
          </p>
        )}
      </form>
    </Modal>
  );
};

// ===== 编辑用户弹窗 =====

interface EditUserModalProps {
  target: AdminUser | null;
  onClose: () => void;
  onSubmit: (input: UserUpdateInput) => Promise<void>;
  isSelf: boolean;
}

const EditUserModal: React.FC<EditUserModalProps> = ({ target, onClose, onSubmit, isSelf }) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [resetPassword, setResetPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) {
      setIsAdmin(target.is_admin);
      setIsActive(target.is_active);
      setResetPassword('');
      setError('');
    }
  }, [target]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setSubmitting(true);
    setError('');
    try {
      const input: UserUpdateInput = {
        is_admin: isAdmin,
        is_active: isActive,
      };
      if (resetPassword.trim()) {
        input.password = resetPassword;
      }
      await onSubmit(input);
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title="编辑用户"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[11px] font-mono uppercase tracking-widest border border-border hover:border-foreground transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            form="edit-user-form"
            disabled={submitting}
            className="px-4 py-2 text-[11px] font-mono uppercase tracking-widest bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting ? '保存中...' : '保存'}
          </button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            用户名
          </p>
          <p className="font-mono font-bold">{target?.username}</p>
        </div>

        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm font-mono uppercase tracking-widest">管理员权限</span>
          <input
            type="checkbox"
            checked={isAdmin}
            disabled={isSelf}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-accent)] disabled:opacity-40"
          />
        </label>
        {isSelf && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground opacity-60 -mt-3">
            不能修改自己的管理员权限
          </p>
        )}

        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm font-mono uppercase tracking-widest">账号启用</span>
          <input
            type="checkbox"
            checked={isActive}
            disabled={isSelf}
            onChange={(e) => setIsActive(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-accent)] disabled:opacity-40"
          />
        </label>
        {isSelf && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground opacity-60 -mt-3">
            不能停用自己的账号
          </p>
        )}

        <div className="border-t border-border pt-4">
          <label className="block text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            重置密码（留空则不修改）
          </label>
          <input
            type="password"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            className="awwwards-input w-full font-mono tracking-widest"
            placeholder=" "
            autoComplete="new-password"
          />
        </div>

        {error && (
          <p className="text-[11px] font-mono uppercase tracking-widest text-primary">
            [ {error} ]
          </p>
        )}
      </form>
    </Modal>
  );
};

export default AdminUsers;
