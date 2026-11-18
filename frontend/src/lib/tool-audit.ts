import { toolsConfig } from '../config/tools';
import type { ToolDefinition } from '../config/tools';

/** 已下线工具的展示名：审计日志保留历史记录，名称仍需可读。 */
const RETIRED_TOOL_NAMES: Record<string, string> = {
  calendar: '日历',
};

/** 审计 action 的工具段（tool.<auditSlug>.<操作>）→ 当前工具目录条目。 */
const TOOL_BY_AUDIT_SLUG = new Map(
  toolsConfig.map((tool) => [tool.auditSlug, tool] as const),
);
const TOOL_BY_ID = new Map(
  toolsConfig.map((tool) => [tool.id, tool] as const),
);

export function findToolByAuditSlug(slug: string): ToolDefinition | undefined {
  return TOOL_BY_AUDIT_SLUG.get(slug);
}

/** 审计 target_id → 工具展示名。
 *  target_id 多数与工具 id 一致，历史数据中也存在 attendance 这类审计 slug，
 *  因此按 id → auditSlug → 已下线工具名的顺序解析。 */
export function findToolDisplayName(targetId: string): string | undefined {
  return (
    TOOL_BY_ID.get(targetId)?.name ??
    TOOL_BY_AUDIT_SLUG.get(targetId)?.name ??
    RETIRED_TOOL_NAMES[targetId]
  );
}
