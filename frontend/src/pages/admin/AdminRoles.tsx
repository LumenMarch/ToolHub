import React, { useCallback, useEffect, useState } from 'react';
import {
  PencilSimple,
  Plus,
  Trash,
  ShieldCheck,
} from '@phosphor-icons/react';
import { useAdminApi } from '../../hooks/useAdminApi';
import type { Role, RoleDetail, Permission, RoleCreateInput } from '../../hooks/useAdminApi';
import DataTable from '../../components/admin/DataTable';
import type { Column } from '../../components/admin/DataTable';
import Modal from '../../components/admin/Modal';
import PermissionGuard from '../../components/PermissionGuard';

const AdminRoles: React.FC = () => {
  const api = useAdminApi();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RoleDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .listRoles()
      .then(setRoles)
      .catch(() => setError('加载角色列表失败'))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async (input: RoleCreateInput) => {
    await api.createRole(input);
    setCreateOpen(false);
    refresh();
  };

  const handleUpdate = async (roleId: number, name?: string, description?: string) => {
    await api.updateRole(roleId, { name, description });
    setEditTarget(null);
    refresh();
  };

  const handleDelete = async (roleId: number) => {
    await api.deleteRole(roleId);
    setDeleteTarget(null);
    refresh();
  };

  const columns: Column<Role>[] = [
    {
      key: 'name',
      header: '角色名',
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 font-mono">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          {r.name}
        </span>
      ),
    },
    {
      key: 'description',
      header: '描述',
      render: (r) =>
        r.description ? (
          <span className="text-sm text-muted-foreground">{r.description}</span>
        ) : (
          <span className="text-[11px] font-mono text-muted-foreground">—</span>
        ),
    },
    {
      key: 'permission_count',
      header: '权限数',
      render: (r) => (
        <span className="font-mono text-sm">{r.permission_count}</span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (r) => (
        <div className="flex items-center gap-1">
          <PermissionGuard permission="role:write">
            <button
              type="button"
              onClick={async () => {
                const perms = await api.getRolePermissions(r.id);
                setEditTarget({ ...r, permissions: perms });
              }}
              className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
              aria-label="编辑角色"
              title="编辑"
            >
              <PencilSimple className="w-4 h-4" />
            </button>
          </PermissionGuard>
          <PermissionGuard permission="role:write">
            <button
              type="button"
              onClick={() => setDeleteTarget(r)}
              className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
              aria-label="删除角色"
              title="删除"
            >
              <Trash className="w-4 h-4" />
            </button>
          </PermissionGuard>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          管理角色定义与权限分配
        </p>
        <PermissionGuard permission="role:write">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono uppercase tracking-widest border border-border hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 新建角色
          </button>
        </PermissionGuard>
      </div>

      {error && (
        <div className="text-sm font-mono text-primary bg-primary/10 p-4 border-l-2 border-primary uppercase tracking-widest">
          [ 异常: {error} ]
        </div>
      )}

      <div className="border border-border">
        <DataTable
          columns={columns}
          data={roles}
          rowKey={(r) => r.id}
          emptyHint={loading ? '加载中...' : '暂无角色'}
        />
      </div>

      <CreateRoleModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />

      <EditRoleModal
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={handleUpdate}
      />

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
          确定要删除角色{' '}
          <span className="font-mono font-bold text-primary">
            {deleteTarget?.name}
          </span>{' '}
          吗？此操作不可撤销，已分配该角色的用户将失去对应权限。
        </p>
      </Modal>
    </div>
  );
};

// ===== 新建角色弹窗 =====

interface CreateRoleModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: RoleCreateInput) => Promise<void>;
}

const CreateRoleModal: React.FC<CreateRoleModalProps> = ({ open, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('角色名不能为空');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
      reset();
    } catch {
      setError('创建失败，角色名可能已存在');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="新建角色"
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
            form="create-role-form"
            disabled={submitting}
            className="px-4 py-2 text-[11px] font-mono uppercase tracking-widest bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting ? '创建中...' : '创建'}
          </button>
        </>
      }
    >
      <form id="create-role-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            角色名
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="awwwards-input w-full"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            描述
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="awwwards-input w-full"
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

// ===== 编辑角色弹窗 =====

interface EditRoleModalProps {
  target: RoleDetail | null;
  onClose: () => void;
  onSubmit: (roleId: number, name?: string, description?: string) => Promise<void>;
}

const EditRoleModal: React.FC<EditRoleModalProps> = ({ target, onClose, onSubmit }) => {
  const api = useAdminApi();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [selectedPermIds, setSelectedPermIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) {
      setName(target.name);
      setDescription(target.description);
      setSelectedPermIds(target.permissions.map((p) => p.id));
      setError('');
      api.listPermissions().then(setAllPermissions).catch(() => {});
    }
  }, [target, api]);

  if (!target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(target.id, name.trim() || undefined, description.trim() || undefined);
      await api.updateRolePermissions(target.id, selectedPermIds);
    } catch {
      setError('保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const togglePermission = (id: number) => {
    setSelectedPermIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="编辑角色"
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
            form="edit-role-form"
            disabled={submitting}
            className="px-4 py-2 text-[11px] font-mono uppercase tracking-widest bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting ? '保存中...' : '保存'}
          </button>
        </>
      }
    >
      <form id="edit-role-form" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            角色名
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="awwwards-input w-full"
            required
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            描述
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="awwwards-input w-full"
          />
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            权限 ({selectedPermIds.length}/{allPermissions.length})
          </p>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {allPermissions.map((perm) => (
              <label
                key={perm.id}
                className="flex items-center gap-2 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedPermIds.includes(perm.id)}
                  onChange={() => togglePermission(perm.id)}
                  className="w-4 h-4 accent-[var(--color-accent)]"
                />
                <code className="text-[11px] font-mono text-muted-foreground w-24 shrink-0">
                  {perm.codename}
                </code>
                <span className="text-sm">{perm.description}</span>
              </label>
            ))}
          </div>
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

export default AdminRoles;
