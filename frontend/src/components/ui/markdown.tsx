import type { ComponentPropsWithoutRef, JSX } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

type MdProps<T extends keyof JSX.IntrinsicElements> = { node?: unknown } & Omit<
  ComponentPropsWithoutRef<T>,
  "node"
>

const blockBase = "my-1.5"

const markdownComponents: Components = {
  p: ({ node: _node, ...props }: MdProps<"p">) => (
    <p className={cn(blockBase, "leading-relaxed")} {...props} />
  ),
  h1: ({ node: _node, ...props }: MdProps<"h1">) => (
    <h1 className={cn("my-2 text-base font-semibold tracking-tight")} {...props} />
  ),
  h2: ({ node: _node, ...props }: MdProps<"h2">) => (
    <h2 className={cn("my-2 text-sm font-semibold tracking-tight")} {...props} />
  ),
  h3: ({ node: _node, ...props }: MdProps<"h3">) => (
    <h3 className={cn("my-2 text-sm font-semibold")} {...props} />
  ),
  h4: ({ node: _node, ...props }: MdProps<"h4">) => (
    <h4 className={cn("my-2 text-sm font-medium")} {...props} />
  ),
  h5: ({ node: _node, ...props }: MdProps<"h5">) => (
    <h5 className={cn("my-2 text-sm font-medium text-muted-foreground")} {...props} />
  ),
  h6: ({ node: _node, ...props }: MdProps<"h6">) => (
    <h6 className={cn("my-2 text-sm font-medium text-muted-foreground")} {...props} />
  ),
  ul: ({ node: _node, ...props }: MdProps<"ul">) => (
    <ul className={cn(blockBase, "list-disc space-y-0.5 pl-5")} {...props} />
  ),
  ol: ({ node: _node, ...props }: MdProps<"ol">) => (
    <ol className={cn(blockBase, "list-decimal space-y-0.5 pl-5")} {...props} />
  ),
  li: ({ node: _node, ...props }: MdProps<"li">) => (
    <li className={cn("leading-relaxed [&>ul]:mt-0.5 [&>ol]:mt-0.5")} {...props} />
  ),
  strong: ({ node: _node, ...props }: MdProps<"strong">) => (
    <strong className={cn("font-semibold text-foreground")} {...props} />
  ),
  em: ({ node: _node, ...props }: MdProps<"em">) => (
    <em className={cn("italic text-foreground/90")} {...props} />
  ),
  del: ({ node: _node, ...props }: MdProps<"del">) => (
    <del className={cn("text-muted-foreground")} {...props} />
  ),
  blockquote: ({ node: _node, ...props }: MdProps<"blockquote">) => (
    <blockquote
      className={cn(
        blockBase,
        "border-l-2 border-border pl-3 leading-relaxed text-muted-foreground",
      )}
      {...props}
    />
  ),
  code: ({ node: _node, ...props }: MdProps<"code">) => (
    <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.875em]")} {...props} />
  ),
  pre: ({ node: _node, ...props }: MdProps<"pre">) => (
    <pre
      className={cn(
        blockBase,
        "overflow-x-auto rounded-md border border-border/60 bg-muted/60 p-3 font-mono text-xs leading-relaxed",
        "[&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-mono [&_code]:text-[1em]",
      )}
      {...props}
    />
  ),
  a: ({ node: _node, ...props }: MdProps<"a">) => {
    const external = typeof props.href === "string" && /^https?:\/\//i.test(props.href)
    return (
      <a
        className={cn("text-primary underline underline-offset-4 hover:text-primary/80")}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
        {...props}
      />
    )
  },
  hr: ({ node: _node, ...props }: MdProps<"hr">) => (
    <hr className={cn("my-3 border-border")} {...props} />
  ),
  table: ({ node: _node, ...props }: MdProps<"table">) => (
    <div className={cn(blockBase, "overflow-x-auto")}>
      <table className={cn("w-full border-collapse text-sm")} {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }: MdProps<"th">) => (
    <th
      className={cn("border border-border bg-muted/60 px-2 py-1 text-left font-medium")}
      {...props}
    />
  ),
  td: ({ node: _node, ...props }: MdProps<"td">) => (
    <td className={cn("border border-border px-2 py-1")} {...props} />
  ),
  img: ({ node: _node, ...props }: MdProps<"img">) => (
    <img className={cn(blockBase, "max-w-full rounded-md")} {...props} />
  ),
  input: ({ node: _node, ...props }: MdProps<"input">) => (
    <input
      className={cn("mr-1.5 inline-block h-3.5 w-3.5 translate-y-0.5 align-middle accent-foreground")}
      {...props}
    />
  ),
}

interface MarkdownProps {
  children: string
  className?: string
}

function Markdown({ children, className }: MarkdownProps) {
  return (
    <div
      data-slot="markdown"
      className={cn(
        "text-sm text-card-foreground [&>:first-child]:mt-0 [&>:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

export { Markdown }
