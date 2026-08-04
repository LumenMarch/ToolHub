import type { RowData } from '@tanstack/react-table';

/**
 * TanStack Table 列 meta 扩展：模板（shadcn-admin）在 meta 中传递单元格样式类。
 */
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string;
    thClassName?: string;
    tdClassName?: string;
    /** 列显示名（用于"显示列"菜单等 UI 文案） */
    title?: string;
  }
}
