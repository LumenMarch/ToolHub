import { useLayoutEffect, useRef } from 'react'

/**
 * 列表条目的补间参数。曲线与 tokens.css 的 `--ease-out-strong` 同值：
 * WAAPI 读不到 Tailwind 工具类，只能把曲线值对齐过去，改一处要改两处。
 */
const FLIP_DURATION_MS = 180
const REMOVE_DURATION_MS = 150
const FLIP_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)'

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 列表重排的 FLIP 补间。
 *
 * React 提交 DOM 后条目已经跳到新位置，用户看到的是"列表重新洗牌"。
 * 这里在 layout 阶段读回各条目的新位置，用 WAAPI 从上一次记录的位置反向播回来，
 * 于是"这一行被移走了"变成可见的动作。只动 transform，不引入额外 state。
 *
 * 用法：容器挂返回的 ref，每个直接子元素带 `data-flip-key`（与 React key 同值）。
 * 首次挂载没有历史位置，不补间（入场交给 CSS 的 animate-in）；
 * 系统开启"减少动效"时直接跳过。
 */
export function useFlipList<T extends HTMLElement = HTMLElement>() {
  const containerRef = useRef<T>(null)
  const topsRef = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canAnimate = !prefersReducedMotion()
    const previous = topsRef.current
    const next = new Map<string, number>()

    for (const child of Array.from(container.children)) {
      const element = child as HTMLElement
      const key = element.dataset.flipKey
      if (!key) continue
      // offsetTop 相对共同的 offsetParent，天然免疫页面滚动；rect.top 会被滚动量污染。
      const top = element.offsetTop
      next.set(key, top)
      if (!canAnimate) continue
      const before = previous.get(key)
      if (before === undefined || before === top) continue
      element.animate(
        [
          { transform: `translateY(${before - top}px)` },
          { transform: 'translateY(0)' },
        ],
        { duration: FLIP_DURATION_MS, easing: FLIP_EASING },
      )
    }

    // 每帧按现存子元素重建，移除的 key 自然作废，不会被复用时误补间。
    topsRef.current = next
  })

  return containerRef
}

/**
 * 条目移除：先原地淡出，再由调用方真正删状态，避免下方条目瞬间合拢。
 *
 * 回调只在动画自然结束时触发；动画被外部取消（例如"重新开始"清空列表）不回调，
 * 由调用方的重置逻辑收尾。因此调用方要按 key 删除、不要按下标删除。
 */
export function animateRowRemoval(
  element: HTMLElement,
  onRemoved: () => void,
): void {
  if (prefersReducedMotion() || typeof element.animate !== 'function') {
    onRemoved()
    return
  }
  const animation = element.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-4px)' },
    ],
    { duration: REMOVE_DURATION_MS, easing: FLIP_EASING, fill: 'forwards' },
  )
  animation.onfinish = onRemoved
}
