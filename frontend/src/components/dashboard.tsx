import { ArrowUpRight, FileSearch, ShieldCheck, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardProps {
  onOpenCsvCompare: () => void;
}

export function Dashboard({ onOpenCsvCompare }: DashboardProps) {
  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl border bg-slate-950 p-7 text-white shadow-sm sm:p-9">
        <div className="relative z-10 max-w-2xl">
          <Badge className="border-white/10 bg-white/10 text-sky-200">ToolHub 预览版</Badge>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
            今天想解决什么问题？
          </h1>
          <p className="mt-3 max-w-xl leading-7 text-slate-300">
            从数据对比开始。后续内部工具将以相同、安全、清晰的体验集中到这里。
          </p>
          <Button className="mt-6 bg-white text-slate-950 hover:bg-slate-100" onClick={onOpenCsvCompare}>
            打开 CSV 数据对比
            <ArrowUpRight className="size-4" />
          </Button>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">全部工具</h2>
            <p className="mt-1 text-sm text-muted-foreground">按需使用，无需安装桌面软件。</p>
          </div>
          <span className="text-sm text-muted-foreground">1 个可用工具</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="group transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
            <CardHeader>
              <div className="mb-3 flex items-start justify-between">
                <div className="flex size-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700">
                  <FileSearch className="size-5" />
                </div>
                <Badge variant="success">可用</Badge>
              </div>
              <CardTitle>CSV 数据对比</CardTitle>
              <CardDescription className="leading-6">
                上传两份 CSV，按主键识别新增、删除和字段变化。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between border-t pt-5">
              <Badge variant="outline">数据处理</Badge>
              <Button size="sm" variant="ghost" onClick={onOpenCsvCompare}>
                打开工具
                <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Button>
            </CardContent>
          </Card>

          <Card className="border-dashed bg-muted/20">
            <CardHeader>
              <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700">
                <Sparkles className="size-5" />
              </div>
              <CardTitle className="text-base">更多工具即将加入</CardTitle>
              <CardDescription className="leading-6">
                工具平台骨架已就绪，后续模块可独立接入。
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <div className="font-medium">登录后访问</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                页面与工具接口均受 Cookie 登录态保护。
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
