import { useState } from "react";
import {
  ArrowRight,
  FileDiff,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DashboardProps {
  onOpenCsvCompare: () => void;
}

export function Dashboard({ onOpenCsvCompare }: DashboardProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const tools = [
    {
      id: "csv-compare",
      name: "CSV 数据对比",
      description: "上传两份 CSV，按唯一主键识别新增、删除与字段变化。",
      category: "数据处理",
      action: onOpenCsvCompare,
    },
  ];
  const visibleTools = tools.filter((tool) =>
    `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(normalizedQuery),
  );

  return (
    <div className="space-y-10">
      <section className="grid gap-8 border-b pb-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.65fr)] lg:gap-14">
        <div>
          <p className="text-sm font-medium text-primary">工具中心</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-[-0.035em] sm:text-4xl lg:text-[2.75rem]">
            需要处理数据时，
            <br className="hidden sm:block" />
            从这里开始。
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            ToolHub 将公司内部工具集中在一个工作台。无需安装桌面软件，登录后即可直接使用。
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button onClick={onOpenCsvCompare}>
              开始对比 CSV
              <ArrowRight className="size-4" />
            </Button>
            <span className="text-sm text-muted-foreground">当前开放 1 个工具</span>
          </div>
        </div>

        <div className="border-l-2 border-primary/20 pl-5 lg:self-end">
          <div className="flex items-start gap-3 py-3">
            <LockKeyhole className="mt-0.5 size-[18px] shrink-0 text-primary" strokeWidth={1.8} />
            <div>
              <div className="text-sm font-medium">统一登录保护</div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                页面与处理接口均需要有效登录状态。
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 py-3">
            <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-primary" strokeWidth={1.8} />
            <div>
              <div className="text-sm font-medium">按模块持续扩展</div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                新工具可独立接入，保持相同的入口与使用方式。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">可用工具</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              选择一个工具开始处理当前任务。
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索工具"
              aria-label="搜索工具"
            />
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border bg-card">
          {visibleTools.length > 0 ? (
            visibleTools.map((tool) => (
              <button
                key={tool.id}
                className="group grid w-full gap-5 p-5 text-left outline-none transition-colors hover:bg-accent/55 focus-visible:bg-accent/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-6"
                type="button"
                onClick={tool.action}
              >
                <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileDiff className="size-6" strokeWidth={1.7} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{tool.name}</h3>
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {tool.category}
                    </span>
                  </div>
                  <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {tool.description}
                  </p>
                </div>
                <span className="flex items-center gap-2 text-sm font-medium text-primary">
                  打开工具
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            ))
          ) : (
            <div className="px-5 py-12 text-center sm:px-6">
              <div className="text-sm font-medium">没有找到相关工具</div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                尝试搜索“CSV”或“数据处理”。
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
