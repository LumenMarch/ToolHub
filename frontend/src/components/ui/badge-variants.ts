import { cva } from "class-variance-authority"

/**
 * Badge 变体定义：独立文件以便组件文件只导出组件（Fast Refresh 友好）。
 * 视觉规范见 docs/design-standards.md §5.9；变量映射见 src/styles/tokens.css。
 */
export const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1.5 py-0.5 text-2xs font-semibold tracking-[0.04em] whitespace-nowrap uppercase transition-[background-color,border-color,color] duration-(--ds-duration-fast) ease-standard focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-surface-3",
        destructive:
          "bg-destructive-soft text-destructive dark:bg-destructive/20 [a]:hover:bg-destructive/15",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-foreground",
        ghost:
          "text-muted-foreground [a]:hover:bg-muted [a]:hover:text-foreground",
        success:
          "bg-success-soft text-success [a]:hover:bg-success/15",
        warning:
          "bg-warning-soft text-warning [a]:hover:bg-warning/15",
        info:
          "bg-info-soft text-info [a]:hover:bg-info/15",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)
