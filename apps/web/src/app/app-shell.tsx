import type { ReactNode } from "react";
import {
  ChevronRight,
  Files,
  Grid2X2,
  LogOut,
  Wrench,
} from "lucide-react";

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
  { id: "dashboard" as const, label: "工具中心", icon: Grid2X2 },
  { id: "csv-compare" as const, label: "CSV 数据对比", icon: Files },
];

export function AppShell({
  children,
  username,
  view,
  onViewChange,
  onLogout,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-muted/40">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar lg:block">
        <div className="flex h-16 items-center gap-3 border-b px-6">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wrench className="size-4" />
          </div>
          <div>
            <div className="font-semibold tracking-tight">ToolHub</div>
            <div className="text-xs text-muted-foreground">Internal workspace</div>
          </div>
        </div>
        <nav className="space-y-1 p-3" aria-label="主导航">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  view === item.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
                type="button"
                onClick={() => onViewChange(item.id)}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2 font-semibold lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wrench className="size-4" />
            </div>
            ToolHub
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium">{username}</div>
              <div className="text-xs text-muted-foreground">内部用户</div>
            </div>
            <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {username.slice(0, 1).toUpperCase()}
            </div>
            <Button size="icon" variant="ghost" onClick={onLogout} aria-label="退出登录">
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          <div className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
            <span>ToolHub</span>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">
              {view === "dashboard" ? "工具中心" : "CSV 数据对比"}
            </span>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
