import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  GripVertical,
  Pencil,
  Save,
  X,
} from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toolsConfig } from '../../config/tools';
import AdminLoadingState from './components/AdminLoadingState';
import { useAdminApi } from './hooks/use-admin-api';
import { toolsMetaQueryKey } from '../../hooks/useToolsMeta';
import type { ToolMeta, ToolMetaUpdateInput } from './hooks/use-admin-api';

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <p className="text-sm text-muted-foreground">
          调整主控台中工具的显示、名称与排序。
        </p>
        <div className="flex items-center gap-3">
          {savedAt && !dirtyCount && (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Check className="size-3.5" /> 已保存
            </span>
          )}
          {dirtyCount > 0 && (
            <span className="text-sm text-primary">
              {dirtyCount} 项未保存
            </span>
          )}
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirtyCount || saving}
          >
            <Save />
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        拖动手柄调整顺序；名称与描述留空时使用代码默认值；禁用的工具不会出现在主控台。
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <AdminLoadingState
          ariaLabel="正在加载后台工具配置"
          label="正在加载工具配置"
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
            <div className="flex flex-col gap-2">
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
      className={cn(
        'rounded-xl border p-4 transition-[border-color,opacity,box-shadow]',
        row.dirty ? 'border-primary' : 'border-border',
        !row.enabled && 'opacity-50',
        isDragging && 'z-50 border-primary opacity-90 shadow-xl',
      )}
      {...attributes}
    >
      <div className="flex items-center gap-4">
        {/* 拖拽手柄（仅手柄响应拖拽，避免输入框/按钮误触） */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
          aria-label="拖动排序"
          title="拖动调整顺序"
          {...listeners}
        >
          <GripVertical />
        </Button>

        <Checkbox
          checked={row.enabled}
          onCheckedChange={(checked) => onToggleEnabled(!!checked)}
          aria-label={row.enabled ? '已启用' : '已禁用'}
        />

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-2">
              <Input
                type="text"
                value={row.custom_name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder={row.default_name}
                className="font-medium"
                autoFocus
              />
              <Input
                type="text"
                value={row.custom_description}
                onChange={(e) => onDescChange(e.target.value)}
                placeholder={row.default_description}
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <h3 className="truncate font-medium tracking-tight">
                  {row.custom_name || row.default_name}
                </h3>
                {row.custom_name && (
                  <Badge variant="outline">自定义</Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {row.custom_description || row.default_description}
              </p>
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => setEditing((v) => !v)}
          aria-label={editing ? '完成编辑' : '编辑'}
          title={editing ? '完成' : '自定义名称/描述'}
        >
          {editing ? <Check /> : <Pencil />}
        </Button>
        {editing && row.custom_name && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={() => {
              onNameChange('');
              onDescChange('');
            }}
            aria-label="恢复默认"
            title="恢复默认"
          >
            <X />
          </Button>
        )}
      </div>
    </div>
  );
};

export default AdminTools;
