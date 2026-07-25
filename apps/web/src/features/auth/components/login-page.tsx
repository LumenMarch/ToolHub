import { FormEvent, useState } from "react";
import { ArrowRight, Blocks, LoaderCircle, LockKeyhole } from "lucide-react";

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
    <main className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(440px,0.95fr)]">
      <section className="hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary-foreground/12">
            <Blocks className="size-5" strokeWidth={1.8} />
          </div>
          <div>
            <div className="font-semibold tracking-tight">ToolHub</div>
            <div className="text-xs text-primary-foreground/65">内部工具平台</div>
          </div>
        </div>
        <div className="max-w-xl pb-12">
          <h1 className="text-4xl font-semibold leading-[1.15] tracking-[-0.035em] xl:text-5xl">
            把重复工作交给工具，把时间留给判断。
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-primary-foreground/72">
            数据处理、文件检查与常用内部流程，集中在一个清晰的工作台。
          </p>
        </div>
      </section>

      <div className="flex items-center justify-center p-5 sm:p-8 lg:p-12">
        <Card className="w-full max-w-md shadow-[0_18px_50px_hsl(var(--shadow)/0.12)]">
          <CardHeader className="space-y-4 pb-4">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
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
