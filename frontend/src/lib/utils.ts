import { cn } from './cn';

export { cn };

/**
 * 生成带省略号的分页页码序列（1 基）。
 *
 * 示例：
 * - 页数 ≤5：[1, 2, 3, 4, 5]
 * - 靠前：[1, 2, 3, 4, '...', 10]
 * - 中间：[1, '...', 4, 5, 6, '...', 10]
 * - 靠后：[1, '...', 7, 8, 9, 10]
 */
export function getPageNumbers(currentPage: number, totalPages: number) {
  // 入参防护：非有限值或非法范围时退化（防止 ?pageSize=0 产生 Infinity 页码）
  if (
    !Number.isFinite(currentPage) ||
    !Number.isFinite(totalPages) ||
    totalPages < 1
  ) {
    return [1]
  }
  const safePage = Math.max(1, Math.min(Math.floor(currentPage), totalPages))
  const maxVisiblePages = 5;
  const rangeWithDots: Array<number | '...'> = [];

  if (totalPages <= maxVisiblePages) {
    for (let i = 1; i <= totalPages; i++) {
      rangeWithDots.push(i);
    }
    return rangeWithDots;
  }

  // 始终显示首页
  rangeWithDots.push(1);

  if (safePage <= 3) {
    // 靠前：[1] [2] [3] [4] ... [末页]
    for (let i = 2; i <= 4; i++) {
      rangeWithDots.push(i);
    }
    rangeWithDots.push('...', totalPages);
  } else if (safePage >= totalPages - 2) {
    // 靠后：[1] ... [n-3] [n-2] [n-1] [n]
    rangeWithDots.push('...');
    for (let i = totalPages - 3; i <= totalPages; i++) {
      rangeWithDots.push(i);
    }
  } else {
    // 中间：[1] ... [p-1] [p] [p+1] ... [末页]
    rangeWithDots.push('...');
    for (let i = safePage - 1; i <= safePage + 1; i++) {
      rangeWithDots.push(i);
    }
    rangeWithDots.push('...', totalPages);
  }

  return rangeWithDots;
}
