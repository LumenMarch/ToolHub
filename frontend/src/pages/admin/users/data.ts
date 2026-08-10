import type { UserStatus } from './schema';
import { parseServerDate } from '../../../lib/format-time';

/** 状态筛选选项（faceted filter + 服务端 status 参数）。 */
export const statusOptions: { label: string; value: string }[] = [
  { label: '待审批', value: 'pending' },
  { label: '已批准', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
];

/** 审批状态徽标样式（Badge outline + 覆盖类），文字与颜色双通道。 */
export const callTypes: Record<
  UserStatus,
  { label: string; className: string }
> = {
  pending: {
    label: '待审批',
    className:
      'border-status-warning-foreground/30 bg-status-warning-surface text-status-warning-foreground',
  },
  approved: {
    label: '已批准',
    className:
      'border-status-success-foreground/30 bg-status-success-surface text-status-success-foreground',
  },
  rejected: {
    label: '已拒绝',
    className:
      'border-status-danger-foreground/30 bg-status-danger-surface text-status-danger-foreground',
  },
};

/** 日期展示：非法/空值统一显示"从未"，避免 Invalid Date 泄漏；后端无时区 UTC，补 Z 解析后按本地时区显示。 */
export function formatAdminDate(value: string | null) {
  const date = parseServerDate(value);
  if (!date) return '从未'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
