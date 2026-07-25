import { useEffect, useState, type ReactNode } from "react";
import {
  Blocks,
  ChevronLeft,
  Files,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  X,
} from "lucide-react";

import { useTheme } from "@/app/theme-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type View = "dashboard" | "csv-compare";

interface AppShellProps {
  children: ReactNode;
  username: string;
  view: View;
  onViewChange: (view: View) => void;
  onLogout: () => void;
}

const navigation = [
  {
    title: "工作台",
    items: [{ id: "dashboard" as const, label: "工具中心", icon: LayoutGrid }],
  },
  {
    title: "数据工具",
    items: [{ id: "csv-compare" as const, label: "CSV 数据对比", icon: Files }],
  },
];

export function AppShell({
  children,
  username,
  view,
  onViewChange,
  onLogout,
}: AppShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const pageTitle = view === "dashboard" ? "工具中心" : "CSV 数据对比";

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMobileOpen]);

  function navigate(nextView: View) {
    onViewChange(nextView);
    setIsMobileOpen(false);
  }

  function renderSidebarContent(collapsed: boolean) {
    return (
      <>
        <div
          className={cn(
            "flex h-16 items-center border-b border-sidebar-border px-3",
            collapsed ? "justify-center" : "gap-3",
          )}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <Blocks className="size-[18px]" strokeWidth={1.8} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight">ToolHub</div>
              <div className="truncate text-xs text-sidebar-foreground/55">内部工具平台</div>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto p-3" aria-label="主导航">
          {navigation.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <div className="mb-1.5 px-2 text-[11px] font-medium tracking-wide text-sidebar-foreground/45">
                  {group.title}
                </div>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className={cn(
                        "flex h-10 w-full items-center rounded-lg text-sm font-medium outline-none transition-[background-color,color,transform] focus-visible:ring-2 focus-visible:ring-sidebar-ring active:scale-[0.98]",
                        collapsed ? "justify-center px-0" : "gap-3 px-3 text-left",
                        view === item.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                      )}
                      type="button"
                      title={collapsed ? item.label : undefined}
                      aria-current={view === item.id ? "page" : undefined}
                      onClick={() => navigate(item.id)}
                    >
                      <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div
            className={cn(
              "flex items-center rounded-lg",
              collapsed ? "flex-col gap-2" : "gap-3 p-2",
            )}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground">
              {username.slice(0, 1).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{username}</div>
                <div className="truncate text-xs text-sidebar-foreground/50">内部用户</div>
              </div>
            )}
            <Button
              className="shrink-0"
              size="icon"
              variant="ghost"
              onClick={onLogout}
              aria-label="退出登录"
              title="退出登录"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <a
        className="fixed left-4 top-3 z-50 -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:translate-y-0"
        href="#main-content"
      >
        跳到主要内容
      </a>

      {isMobileOpen && (
        <button
          className="fixed inset-0 z-30 bg-foreground/25 backdrop-blur-[2px] lg:hidden"
          type="button"
          aria-label="关闭导航"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {isMobileOpen && (
        <aside
          className="fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="移动端导航"
        >
          <Button
            className="absolute right-3 top-3"
            size="icon"
            variant="ghost"
            onClick={() => setIsMobileOpen(false)}
            aria-label="关闭导航"
          >
            <X className="size-4" />
          </Button>
          {renderSidebarContent(false)}
        </aside>
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
          isCollapsed ? "w-[76px]" : "w-[248px]",
        )}
      >
        {renderSidebarContent(isCollapsed)}
        <button
          className="absolute -right-3 top-[76px] flex size-6 items-center justify-center rounded-full border border-sidebar-border bg-background text-muted-foreground shadow-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          type="button"
          onClick={() => setIsCollapsed((current) => !current)}
          aria-label={isCollapsed ? "展开侧栏" : "收起侧栏"}
          title={isCollapsed ? "展开侧栏" : "收起侧栏"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="size-3.5" />
          ) : (
            <PanelLeftClose className="size-3.5" />
          )}
        </button>
      </aside>

      <div
        className={cn(
          "transition-[padding-left] duration-200",
          isCollapsed ? "lg:pl-[76px]" : "lg:pl-[248px]",
        )}
      >
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur-md sm:px-6">
          <Button
            className="lg:hidden"
            size="icon"
            variant="outline"
            onClick={() => setIsMobileOpen(true)}
            aria-label="打开导航"
          >
            <Menu className="size-4" />
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            {view !== "dashboard" && (
              <>
                <button
                  className="hidden items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
                  type="button"
                  onClick={() => navigate("dashboard")}
                >
                  <ChevronLeft className="size-4" />
                  工具中心
                </button>
                <span className="hidden text-border sm:inline">/</span>
              </>
            )}
            <span className="truncate text-sm font-semibold">{pageTitle}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label={resolvedTheme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
              title={resolvedTheme === "dark" ? "浅色主题" : "深色主题"}
            >
              {resolvedTheme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
            <div className="h-6 w-px bg-border" aria-hidden="true" />
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
              {username.slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
