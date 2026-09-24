import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

/**
 * 折叠内容。
 *
 * 高度动画走 layout（每帧重排），这是折叠区少见的可接受例外：位移本身就是要表达的
 * 信息——内容是从按钮下面长出来的，不是凭空出现的。出场比入场快（曲线见 tokens.css）。
 * 减少动效时退化为纯淡入，见 tokens.css 末尾的 [data-slot=collapsible-content] 规则。
 */
function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
        className,
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleContent }
