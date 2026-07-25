import { FormEvent, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
  UploadCloud,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, type CsvComparisonResult } from "@/lib/api";

interface CsvCompareProps {
  onBack: () => void;
}

function FileField({
  id,
  label,
  description,
  file,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label
      className="group flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.03]"
      htmlFor={id}
    >
      <input
        className="sr-only"
        id={id}
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <div className="flex size-11 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border">
        {file ? (
          <CheckCircle2 className="size-5 text-emerald-600" />
        ) : (
          <UploadCloud className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="mt-4 font-medium">{file ? file.name : label}</div>
      <div className="mt-1 text-sm text-muted-foreground">
        {file ? `${(file.size / 1024).toFixed(1)} KB` : description}
      </div>
    </label>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`mt-2 text-3xl font-semibold tracking-tight ${tone}`}>
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

function RecordList({
  title,
  description,
  records,
  variant,
}: {
  title: string;
  description: string;
  records: Array<{ key: string; row: Record<string, string> }>;
  variant: "success" | "danger";
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription className="mt-1.5">{description}</CardDescription>
          </div>
          <Badge variant={variant}>{records.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            没有相关记录
          </div>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {records.map((record) => (
              <div
                key={record.key}
                className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5"
              >
                <span className="font-mono text-xs">{record.key}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {Object.entries(record.row)
                    .slice(0, 3)
                    .map(([field, value]) => `${field}: ${value || "（空）"}`)
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CsvCompare({ onBack }: CsvCompareProps) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [primaryKey, setPrimaryKey] = useState("");
  const [trimWhitespace, setTrimWhitespace] = useState(true);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [result, setResult] = useState<CsvComparisonResult | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceFile || !targetFile) {
      setError("请先选择两份 CSV 文件");
      return;
    }

    setError("");
    setIsSubmitting(true);
    const payload = new FormData();
    payload.append("source_file", sourceFile);
    payload.append("target_file", targetFile);
    payload.append("primary_key", primaryKey);
    payload.append("trim_whitespace", String(trimWhitespace));
    payload.append("ignore_case", String(ignoreCase));

    try {
      setResult(await api.compareCsv(payload));
    } catch (compareError) {
      setError(compareError instanceof Error ? compareError.message : "对比失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  function reset() {
    setSourceFile(null);
    setTargetFile(null);
    setPrimaryKey("");
    setResult(null);
    setError("");
  }

  if (result) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge variant="success">对比完成</Badge>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">数据差异结果</h1>
            <p className="mt-2 text-muted-foreground">
              {result.files.source} 与 {result.files.target}
            </p>
          </div>
          <Button variant="outline" onClick={reset}>
            <RefreshCw className="size-4" />
            重新对比
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="新增记录" value={result.summary.added} tone="text-emerald-600" />
          <SummaryCard label="删除记录" value={result.summary.deleted} tone="text-rose-600" />
          <SummaryCard label="修改记录" value={result.summary.modified} tone="text-amber-600" />
          <SummaryCard label="未变化" value={result.summary.unchanged} tone="text-slate-700" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>字段级修改</CardTitle>
            <CardDescription>
              按主键 {result.metadata.primaryKey} 展示前后值，页面最多显示 {result.metadata.resultLimit} 条。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.modified.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                没有字段修改记录
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">主键</th>
                        <th className="px-4 py-3 font-medium">字段</th>
                        <th className="px-4 py-3 font-medium">基准值</th>
                        <th className="px-4 py-3 font-medium">对比值</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.modified.flatMap((record) =>
                        record.changes.map((change) => (
                          <tr key={`${record.key}-${change.field}`} className="hover:bg-muted/30">
                            <td className="px-4 py-3 font-mono text-xs">{record.key}</td>
                            <td className="px-4 py-3 font-medium">{change.field}</td>
                            <td className="px-4 py-3">
                              <span className="rounded bg-rose-500/10 px-2 py-1 text-rose-700">
                                {change.before || "（空）"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-700">
                                {change.after || "（空）"}
                              </span>
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <RecordList
            title="新增记录"
            description="仅存在于对比文件中的记录"
            records={result.added}
            variant="success"
          />
          <RecordList
            title="删除记录"
            description="仅存在于基准文件中的记录"
            records={result.deleted}
            variant="danger"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button className="-ml-3 mb-3" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
          返回工具中心
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">CSV 数据对比</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          上传基准文件和对比文件，通过唯一主键快速找到新增、删除和字段变化。
        </p>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-primary" />
              1. 上传文件
            </CardTitle>
            <CardDescription>支持 UTF-8、GB18030 和 Big5 编码，单个文件不超过 20 MB。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <FileField
              id="source-file"
              label="选择基准 CSV"
              description="作为变化前的数据基准"
              file={sourceFile}
              onChange={setSourceFile}
            />
            <FileField
              id="target-file"
              label="选择对比 CSV"
              description="作为变化后的目标数据"
              file={targetFile}
              onChange={setTargetFile}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. 配置规则</CardTitle>
            <CardDescription>两份文件中必须存在相同名称且不重复的主键字段。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="primary-key">
                主键字段
              </label>
              <Input
                id="primary-key"
                value={primaryKey}
                onChange={(event) => setPrimaryKey(event.target.value)}
                placeholder="例如 employee_id"
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                <input
                  className="mt-1 size-4 accent-primary"
                  type="checkbox"
                  checked={trimWhitespace}
                  onChange={(event) => setTrimWhitespace(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium">忽略首尾空格</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    避免不可见空格造成误判
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                <input
                  className="mt-1 size-4 accent-primary"
                  type="checkbox"
                  checked={ignoreCase}
                  onChange={(event) => setIgnoreCase(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium">忽略大小写</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    将 ABC 与 abc 视为相同
                  </span>
                </span>
              </label>
            </div>
          </CardContent>
        </Card>

        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button className="min-w-36" disabled={isSubmitting} type="submit">
            {isSubmitting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                正在对比
              </>
            ) : (
              "开始对比"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
