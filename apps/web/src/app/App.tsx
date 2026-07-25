import { useEffect, useState } from "react";

import { AppShell } from "@/app/app-shell";
import { authApi, type User } from "@/features/auth/api";
import { LoginPage } from "@/features/auth/components/login-page";
import { CsvCompare } from "@/features/csv-compare/components/csv-compare";
import { Dashboard } from "@/features/tool-catalog/components/dashboard";

type View = "dashboard" | "csv-compare";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    authApi
      .getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleLogout() {
    await authApi.logout();
    setUser(null);
    setView("dashboard");
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div
          className="flex items-center gap-3 text-sm text-muted-foreground"
          role="status"
        >
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          正在加载工作台
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  return (
    <AppShell
      username={user.username}
      view={view}
      onViewChange={setView}
      onLogout={handleLogout}
    >
      {view === "dashboard" ? (
        <Dashboard onOpenCsvCompare={() => setView("csv-compare")} />
      ) : (
        <CsvCompare onBack={() => setView("dashboard")} />
      )}
    </AppShell>
  );
}
