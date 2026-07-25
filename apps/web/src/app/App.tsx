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
      <div className="flex min-h-screen items-center justify-center bg-muted/40">
        <div className="size-8 animate-pulse rounded-xl bg-primary/20" aria-label="正在加载" />
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
