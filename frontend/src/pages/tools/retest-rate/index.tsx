import { useState } from 'react'
import { Play, Trash2, X } from 'lucide-react'

import api from '@/api/axios'
import FileDropZone from '@/components/FileDropZone'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useTusUpload } from '@/hooks/useTusUpload'
import type { ReasonMap } from './report'
import { ResultPanel } from './result'
import type { AnalyzeResult } from './types'

/*
 * API 契约：
 *   POST /tools/retest-rate/analyze  body { upload_ids } → 重测率统计结果
 * 文件经 tus 上传（数组顺序即分析顺序，首个文件用于识别格式与解析规格）；
 * 统计口径与明细见 types.ts；报告导出（CSV / HTML）在客户端完成。
 *
 * 统计口径（移植自 insight 数据重测率统计工具 v1.6）：
 * - 重测 SN = 曾 PASS 且曾 FAIL；不良 SN = 从未 PASS；
 * - 测试时间仅统计 PASS 记录；Station|Slot 按 SN 首条记录归属。
 * 结果展示与导出见 result.tsx / report.ts。
 */

const readErrorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: { detail?: string } } })?.response
  return response?.data?.detail || '处理失败，请稍后重试'
}

/**
 * 逐个上传文件并收集 upload_id（顺序即分析顺序）。
 *
 * 有意串行而非 Promise.all：useTusUpload 是单文件 hook，内部进度状态为
 * 单例，并行上传会互相覆盖状态显示，且服务端缓存检查/分块上传也不宜并发。
 */
async function uploadSequentially(
  files: readonly File[],
  upload: (options: { file: File }) => Promise<string>,
  onFileStart: (index: number, name: string) => void,
): Promise<string[]> {
  const uploadIds: string[] = []
  for (let i = 0; i < files.length; i++) {
    onFileStart(i + 1, files[i].name)
    uploadIds.push(await upload({ file: files[i] }))
  }
  return uploadIds
}

const RetestRateTool: React.FC = () => {
  const { upload } = useTusUpload()
  const [files, setFiles] = useState<File[]>([])
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [reasons, setReasons] = useState<ReasonMap>({})
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [error, setError] = useState('')

  const addFiles = (incoming: File[]) => {
    setError('')
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const merged = [...prev]
      for (const file of incoming) {
        if (!file.name.toLowerCase().endsWith('.csv')) continue
        const key = `${file.name}:${file.size}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(file)
      }
      return merged
    })
  }

  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index))

  const clearFiles = () => {
    setFiles([])
    setError('')
  }

  const handleReasonChange = (key: string, value: string) =>
    setReasons((prev) => ({ ...prev, [key]: value }))

  const handleAnalyze = async () => {
    if (files.length === 0 || busy) return
    setBusy(true)
    setError('')
    setResult(null)
    setReasons({})
    try {
      const uploadIds = await uploadSequentially(
        files,
        upload,
        (index, name) => setBusyLabel(`正在上传 ${index}/${files.length}：${name}`),
      )
      setBusyLabel('正在分析…')
      const response = await api.post<AnalyzeResult>(
        '/tools/retest-rate/analyze',
        { upload_ids: uploadIds },
      )
      setResult(response.data)
    } catch (err) {
      setError(readErrorMessage(err))
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">重测率统计</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          汇总多份产线测试 CSV（insight/Hilo、DCR/Moose、Atlas、Summary、Unit
          Archive 合并导出自动识别），以 SN 为单位统计重测率与不良率，第一个文件用于识别格式与测试项规格。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>待分析 CSV 文件</CardTitle>
          <CardDescription>
            支持拖放或选择多个 .csv 文件，可分批追加，重复文件自动忽略。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FileDropZone
            id="retest-rate-files"
            label="测试数据 CSV"
            description="拖放 .csv 文件到此处，或点击选择（可多选）"
            accept=".csv,text/csv"
            file={null}
            multiple
            onSelect={() => {}}
            onSelectMultiple={addFiles}
            disabled={busy}
          />

          {files.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.name}:${file.size}`}
                  className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate" title={file.name}>
                    {index + 1}. {file.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeFile(index)}
                    disabled={busy}
                    aria-label={`移除 ${file.name}`}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void handleAnalyze()} disabled={busy || files.length === 0}>
              {busy ? <Spinner /> : <Play />}
              {busy ? (busyLabel || '处理中…') : '开始分析'}
            </Button>
            <Button
              variant="ghost"
              onClick={clearFiles}
              disabled={busy || files.length === 0}
            >
              <Trash2 />
              清空列表
            </Button>
            {files.length > 0 ? (
              <span className="text-sm text-muted-foreground">
                共 {files.length} 个文件
              </span>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <ResultPanel
          result={result}
          reasons={reasons}
          onReasonChange={handleReasonChange}
        />
      ) : null}
    </div>
  )
}

export default RetestRateTool
