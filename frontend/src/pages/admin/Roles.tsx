import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PencilSimple,
  Plus,
  ShieldCheck,
  Trash,
} from '@phosphor-icons/react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { useAdminApi } from './hooks/use-admin-api';
import type {
  Permission,
  Role,
  RoleCreateInput,
  RoleDetail,
} from './hooks/use-admin-api';
import AdminLoadingState from './components/AdminLoadingState';
import PermissionGuard from '../../components/guards/PermissionGuard';

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
    try {
      await api.deleteRole(roleId);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      console.error('删除角色失败', err);
      setError('删除角色失败');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          管理角色定义与权限分配
        </p>
        <PermissionGuard permission="role:write">
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> 新建角色
          </Button>
        </PermissionGuard>
      </div>

      {error && (
        <div className="text-sm font-mono text-primary bg-primary/10 p-4 border-l-2 border-primary uppercase tracking-widest">
          [ 异常: {error} ]
        </div>
      )}

      {loading ? (
        <AdminLoadingState
          ariaLabel="正在加载后台角色目录"
          label="[ 角色目录 · 同步中 ]"
          detail="等待权限索引"
        />
      ) : (
        <div className="border border-border">
          <Table>
            <TableHeader>
              <TableRow className="group/row">
                <TableHead className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                  角色名
                </TableHead>
                <TableHead className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                  描述
                </TableHead>
                <TableHead className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                  权限数
                </TableHead>
                <TableHead className="w-24 text-right text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-12 text-center text-[11px] font-mono uppercase tracking-widest text-muted-foreground opacity-60"
                  >
                    暂无角色
                  </TableCell>
                </TableRow>
              ) : (
                roles.map((role) => (
                  <TableRow key={role.id} className="group/row">
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                        {role.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      {role.description ? (
                        <span className="text-sm text-muted-foreground">
                          {role.description}
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">{role.permission_count}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <PermissionGuard permission="role:write">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={async () => {
                              try {
                                const perms = await api.getRolePermissions(role.id);
                                setEditTarget({ ...role, permissions: perms });
                              } catch (err) {
                                console.error('加载角色权限失败', err);
                                setError('加载角色权限失败');
                              }
                            }}
                            aria-label="编辑角色"
                            title="编辑"
                          >
                            <PencilSimple className="w-4 h-4" />
                          </Button>
                        </PermissionGuard>
                        <PermissionGuard permission="role:write">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(role)}
                            aria-label="删除角色"
                            title="删除"
                          >
                            <Trash className="w-4 h-4" />
                          </Button>
                        </PermissionGuard>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateRoleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />

      {editTarget && (
        <EditRoleDialog
          key={editTarget.id}
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSubmit={handleUpdate}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        destructive
        title="确认删除"
        desc={
          <p>
            确定要删除角色{' '}
            <span className="font-mono font-bold text-primary">
              {deleteTarget?.name}
            </span>{' '}
            吗？此操作不可撤销，已分配该角色的用户将失去对应权限。
          </p>
        }
        confirmText="确认删除"
        cancelBtnText="取消"
        handleConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget.id);
        }}
      />
    </div>
  );
};

// ===== 新建角色弹窗 =====

interface CreateRoleDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: RoleCreateInput) => Promise<void>;
}

const CreateRoleDialog: React.FC<CreateRoleDialogProps> = ({ open, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
    setError('');
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>新建角色</DialogTitle>
          <DialogDescription>定义角色名称与描述。</DialogDescription>
        </DialogHeader>
        <form id="create-role-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="create-role-name" className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              角色名
            </Label>
            <Input
              id="create-role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-role-description" className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              描述
            </Label>
            <Input
              id="create-role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-[11px] font-mono uppercase tracking-widest text-primary">
              [ {error} ]
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            取消
          </Button>
          <Button type="submit" form="create-role-form" disabled={submitting}>
            {submitting ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ===== 编辑角色弹窗 =====

interface EditRoleDialogProps {
  target: RoleDetail;
  onClose: () => void;
  onSubmit: (roleId: number, name?: string, description?: string) => Promise<void>;
}

const EditRoleDialog: React.FC<EditRoleDialogProps> = ({ target, onClose, onSubmit }) => {
  const api = useAdminApi();

  const [name, setName] = useState(target.name);
  const [description, setDescription] = useState(target.description);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [selectedPermIds, setSelectedPermIds] = useState<number[]>(
    () => target.permissions.map((permission) => permission.id),
  );
  // 工具权限模式：'all' = 工具使用者（全部工具），'custom' = 自定义逐个勾选；初始为自定义
  const [toolMode, setToolMode] = useState<'all' | 'custom'>('custom');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.listPermissions().then(setAllPermissions).catch(() => {});
  }, [api]);

  // 全部 tool: 前缀权限的 id，供「工具使用者」模式的全选与初始状态判断使用
  const allToolPermIds = useMemo(
    () =>
      allPermissions.flatMap((perm) =>
        perm.codename.startsWith('tool:') ? [perm.id] : [],
      ),
    [allPermissions],
  );

  // 首次加载权限列表完成后同步一次模式：若当前角色已持有全部 tool: 权限，说明它是
  // 「工具使用者」状态，自动切到 'all' 以如实反映；否则保持 'custom'。
  // 用 ref 保证只同步这一次，后续（用户勾选/切换后）不再覆盖用户的模式选择。
  const hasSyncedToolMode = useRef(false);
  const selectedPermIdSet = useMemo(
    () => new Set(selectedPermIds),
    [selectedPermIds],
  );
  useEffect(() => {
    if (hasSyncedToolMode.current || allPermissions.length === 0) return;
    hasSyncedToolMode.current = true;
    const holdsAllTools =
      allToolPermIds.length > 0 &&
      allToolPermIds.every((id) => selectedPermIdSet.has(id));
    setToolMode(holdsAllTools ? 'all' : 'custom');
  }, [allPermissions, allToolPermIds, selectedPermIdSet]);

  // 切换工具权限模式：'all' 时并入全部工具权限 id（管理权限保持不动）；'custom' 时不动已选集合
  const switchToolMode = (mode: 'all' | 'custom') => {
    setToolMode(mode);
    if (mode === 'all') {
      setSelectedPermIds((prev) =>
        Array.from(new Set([...prev, ...allToolPermIds])),
      );
    }
  };

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

  const selectedPermissionIdSet = new Set(selectedPermIds);

  // 按 tool: 前缀把权限分为「工具权限 / 管理权限」两组，组内按 codename 排序
  const permissionGroups = useMemo(() => {
    const byCodename = (a: Permission, b: Permission) =>
      a.codename.localeCompare(b.codename);
    const toolPermissions = allPermissions
      .filter((perm) => perm.codename.startsWith('tool:'))
      .sort(byCodename);
    const adminPermissions = allPermissions
      .filter((perm) => !perm.codename.startsWith('tool:'))
      .sort(byCodename);
    return [
      { title: '工具权限', items: toolPermissions },
      { title: '管理权限', items: adminPermissions },
    ];
  }, [allPermissions]);

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>编辑角色</DialogTitle>
          <DialogDescription>更新角色信息与权限分配。</DialogDescription>
        </DialogHeader>
        <form id="edit-role-form" onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="edit-role-name" className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              角色名
            </Label>
            <Input
              id="edit-role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-role-description" className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              描述
            </Label>
            <Input
              id="edit-role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              权限 ({selectedPermIds.length}/{allPermissions.length})
            </p>
            <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
              {permissionGroups.map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">
                    {group.title} ({group.items.length})
                  </p>
                  {/* 工具权限组：二选一模式——工具使用者（全部工具）/ 自定义逐个勾选 */}
                  {group.title === '工具权限' && (
                    <div className="pt-0.5 pb-1 space-y-1">
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="tool-permission-mode"
                          checked={toolMode === 'all'}
                          onChange={() => switchToolMode('all')}
                          className="w-4 h-4 accent-[var(--color-brand)]"
                        />
                        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                          工具使用者（全部工具）
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="tool-permission-mode"
                          checked={toolMode === 'custom'}
                          onChange={() => switchToolMode('custom')}
                          className="w-4 h-4 accent-[var(--color-brand)]"
                        />
                        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                          自定义工具权限
                        </span>
                      </label>
                    </div>
                  )}
                  {group.items.map((perm) => {
                    // 「工具使用者」模式下工具权限复选框整体禁用，只能由 radio 统一授予/收回
                    const disabled =
                      group.title === '工具权限' && toolMode === 'all';
                    return (
                      <label
                        key={perm.id}
                        className={`flex items-center gap-2 text-sm ${
                          disabled
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPermissionIdSet.has(perm.id)}
                          onChange={() => togglePermission(perm.id)}
                          disabled={disabled}
                          className="w-4 h-4 accent-[var(--color-brand)]"
                        />
                        <code className="text-[11px] font-mono text-muted-foreground w-24 shrink-0">
                          {perm.codename}
                        </code>
                        <span className="text-sm">{perm.description}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-[11px] font-mono uppercase tracking-widest text-primary">
              [ {error} ]
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="edit-role-form" disabled={submitting}>
            {submitting ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdminRoles;
