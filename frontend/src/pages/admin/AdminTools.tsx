import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  DotsSixVertical,
  FloppyDisk,
  PencilSimple,
  X,
} from '@phosphor-icons/react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { toolsConfig } from '../../config/tools';
import AdminLoadingState from '../../components/admin/AdminLoadingState';
import { useAdminApi } from '../../hooks/useAdminApi';
import { toolsMetaQueryKey } from '../../hooks/useToolsMeta';
import type { ToolMeta, ToolMetaUpdateInput } from '../../hooks/useAdminApi';

// 与硬编码 tools.ts 合并后的本地编辑行结构。
interface EditableRow {
  tool_id: string;
  default_name: string;
  default_description: string;
  enabled: boolean;
  sort_order: number;
  custom_name: string;
  custom_description: string;
  dirty: boolean; // 是否有未保存改动
}

const AdminTools: React.FC = () => {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const mergeRows = useCallback((metas: ToolMeta[]) => {
    const metaMap = new Map(metas.map((m) => [m.tool_id, m]));
    return toolsConfig.map((t, index) => {
      const meta = metaMap.get(t.id);
      return {
        tool_id: t.id,
        default_name: t.name,
        default_description: t.description,
        enabled: meta?.enabled ?? true,
        sort_order: meta?.sort_order ?? index,
        custom_name: meta?.custom_name ?? '',
        custom_description: meta?.custom_description ?? '',
        dirty: false,
      };
    });
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .listToolMetas()
      .then((metas) => setRows(mergeRows(metas)))
      .catch(() => setError('加载工具元数据失败'))
      .finally(() => setLoading(false));
  }, [api, mergeRows]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 按当前 sort_order 排序展示，作为 dnd-kit 的数据源。
  const sortedRows = useMemo(
    () => rows.toSorted((a, b) => a.sort_order - b.sort_order),
    [rows],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 拖拽启动阈值，避免点击误触。
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromId = String(active.id);
    const toId = String(over.id);

    const fromIndex = sortedRows.findIndex((r) => r.tool_id === fromId);
    const toIndex = sortedRows.findIndex((r) => r.tool_id === toId);
    if (fromIndex < 0 || toIndex < 0) return;

    // 移除被拖项再插入到目标位置，按新顺序重新分配 sort_order。
    const newSorted = arrayMove(sortedRows, fromIndex, toIndex);
    const newOrders = new Map<string, number>();
    newSorted.forEach((r, i) => newOrders.set(r.tool_id, i));

    setRows((prev) =>
      prev.map((r) => {
        const newOrder = newOrders.get(r.tool_id);
        return newOrder !== undefined && newOrder !== r.sort_order
          ? { ...r, sort_order: newOrder, dirty: true }
          : r;
      }),
    );
  };

  const updateRow = (toolId: string, patch: Partial<EditableRow>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.tool_id === toolId ? { ...r, ...patch, dirty: true } : r,
      ),
    );
  };

  const dirtyCount = rows.filter((r) => r.dirty).length;

  const handleSave = async () => {
    const dirtyRows = rows.filter((r) => r.dirty);
    if (dirtyRows.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const items = dirtyRows.map((r) => {
        const item: ToolMetaUpdateInput & { tool_id: string } = {
          tool_id: r.tool_id,
          enabled: r.enabled,
          sort_order: r.sort_order,
        };
        // 始终发送名称和描述，空字符串表示恢复默认值
        item.custom_name = r.custom_name.trim();
        item.custom_description = r.custom_description.trim();
        return item;
      });
      await api.bulkUpdateToolMetas(items);
      await queryClient.invalidateQueries({ queryKey: toolsMetaQueryKey });
      setSavedAt(Date.now());
      setRows((prev) => prev.map((r) => ({ ...r, dirty: false })));
    } catch {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          调整主控台中工具的显示、名称与排序
        </p>
        <div className="flex items-center gap-3">
          {savedAt && !dirtyCount && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              <Check className="w-3.5 h-3.5" /> 已保存
            </span>
          )}
          {dirtyCount > 0 && (
            <span className="text-[11px] font-mono uppercase tracking-widest text-primary">
              {dirtyCount} 项未保存
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirtyCount || saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono uppercase tracking-widest border border-border hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FloppyDisk className="w-3.5 h-3.5" />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground opacity-70 border-l-2 border-border pl-4">
        拖动手柄调整顺序；名称与描述留空时使用代码默认值；禁用的工具不会出现在主控台。
      </div>

      {error && (
        <div className="text-sm font-mono text-primary bg-primary/10 p-4 border-l-2 border-primary uppercase tracking-widest">
          [ 异常: {error} ]
        </div>
      )}

      {loading ? (
        <AdminLoadingState
          ariaLabel="正在加载后台工具配置"
          label="[ 工具配置 · 同步中 ]"
          detail="等待元数据"
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedRows.map((r) => r.tool_id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {sortedRows.map((row) => (
                <ToolRow
                  key={row.tool_id}
                  row={row}
                  onToggleEnabled={(v) => updateRow(row.tool_id, { enabled: v })}
                  onNameChange={(v) => updateRow(row.tool_id, { custom_name: v })}
                  onDescChange={(v) => updateRow(row.tool_id, { custom_description: v })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
};

interface ToolRowProps {
  row: EditableRow;
  onToggleEnabled: (v: boolean) => void;
  onNameChange: (v: string) => void;
  onDescChange: (v: string) => void;
}

const ToolRow: React.FC<ToolRowProps> = ({
  row,
  onToggleEnabled,
  onNameChange,
  onDescChange,
}) => {
  const [editing, setEditing] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.tool_id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`border p-4 transition-[border-color,opacity,box-shadow] ${
        row.dirty ? 'border-primary' : 'border-border'
      } ${!row.enabled ? 'opacity-50' : ''} ${
        isDragging
          ? 'border-primary shadow-xl opacity-90 z-50'
          : ''
      }`}
      {...attributes}
    >
      <div className="flex items-center gap-4">
        {/* 拖拽手柄（仅手柄响应拖拽，避免输入框/按钮误触） */}
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-primary transition-colors shrink-0 touch-none"
          aria-label="拖动排序"
          title="拖动调整顺序"
          {...listeners}
        >
          <DotsSixVertical className="w-5 h-5" />
        </button>

        {/* 启用开关 */}
        <label className="cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-accent)]"
            aria-label={row.enabled ? '已启用' : '已禁用'}
          />
        </label>

        {/* 名称 + 描述 */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <input
                type="text"
                value={row.custom_name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder={row.default_name}
                className="awwwards-input w-full font-bold"
                autoFocus
              />
              <input
                type="text"
                value={row.custom_description}
                onChange={(e) => onDescChange(e.target.value)}
                placeholder={row.default_description}
                className="awwwards-input w-full text-sm"
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold tracking-tight truncate">
                  {row.custom_name || row.default_name}
                </h3>
                {row.custom_name && (
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground opacity-60">
                    (自定义)
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {row.custom_description || row.default_description}
              </p>
            </div>
          )}
        </div>

        {/* 编辑/完成按钮 */}
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="p-1.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
          aria-label={editing ? '完成编辑' : '编辑'}
          title={editing ? '完成' : '自定义名称/描述'}
        >
          {editing ? <Check className="w-4 h-4" /> : <PencilSimple className="w-4 h-4" />}
        </button>
        {editing && row.custom_name && (
          <button
            type="button"
            onClick={() => {
              onNameChange('');
              onDescChange('');
            }}
            className="p-1.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
            aria-label="恢复默认"
            title="恢复默认"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default AdminTools;
