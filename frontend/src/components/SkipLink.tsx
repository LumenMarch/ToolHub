interface SkipLinkProps {
  /** 跳转目标元素 id */
  targetId: string
  label?: string
}

/**
 * 键盘用户的“跳到主要内容”链接：平时对屏幕阅读器隐藏，
 * 首次 Tab 聚焦时显示。须放在定位（sticky/relative）容器内的
 * 第一个可聚焦位置，absolute 才能浮现在其上方。
 */
export function SkipLink({ targetId, label = '跳到主要内容' }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only rounded-lg focus:not-sr-only focus:absolute focus:top-2 focus:left-3 focus:border focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:shadow-md focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {label}
    </a>
  )
}
