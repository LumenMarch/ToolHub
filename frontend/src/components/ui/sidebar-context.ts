import * as React from "react"

/**
 * Sidebar 上下文与读取 hook。
 *
 * 独立于 sidebar.tsx：组件文件只导出组件，避免非组件导出让整模块的
 * Fast Refresh 失效（与 toggle-variants.ts / button-variants.ts 同一约定）。
 */
export type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

export const SidebarContext = React.createContext<SidebarContextProps | null>(null)

export function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}
