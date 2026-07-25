import { FormEvent, useState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authApi, type User } from "@/features/auth/api";

interface LoginPageProps {
  onLogin: (user: User) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      onLogin(await authApi.login(username, password));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.18),transparent_40%)]" />
      <div className="relative grid w-full max-w-5xl gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <section className="hidden text-white lg:block">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-sky-200">
            <Sparkles className="size-4" />
            公司内部效率中心
          </div>
          <h1 className="max-w-xl text-5xl font-semibold leading-tight tracking-tight">
            把重复工作交给工具，
            <span className="text-sky-300">把时间留给判断。</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            ToolHub 将数据处理、文件检查和常用内部流程集中在一个清晰、安全的工作台。
          </p>
        </section>

        <Card className="border-white/10 bg-white shadow-2xl shadow-black/30">
          <CardHeader className="space-y-4 pb-4">
            <div className="flex size-11 items-center justify-center rounded-xl bg-slate-950 text-white">
              <LockKeyhole className="size-5" />
            </div>
            <div>
              <CardTitle className="text-2xl">登录 ToolHub</CardTitle>
              <CardDescription className="mt-2">使用内部账号继续访问工具中心。</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="username">
                  用户名
                </label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="输入用户名"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="password">
                  密码
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入密码"
                  required
                />
              </div>
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button className="w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    正在登录
                  </>
                ) : (
                  <>
                    进入工具中心
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
