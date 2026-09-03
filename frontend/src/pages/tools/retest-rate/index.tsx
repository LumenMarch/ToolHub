import { useState } from 'react'
import {
  FileCode,
  FileSpreadsheet,
  Play,
  Trash2,
  X,
} from 'lucide-react'

import api from '@/api/axios'
import FileDropZone from '@/components/FileDropZone'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useTusUpload } from '@/hooks/useTusUpload'
import {
  exportCsvReport,
  exportHtmlReport,
  reasonKey,
  type ReasonMap,
} from './report'
import {
  formatRate,
  OVERVIEW_LABELS,
  RETEST_STAT_LABELS,
  TIME_LABELS,
  type AnalyzeResult,
  type DefectItemDetail,
  type RetestItemDetail,
} from './types'

/*
 * API 契约：
 *   POST /tools/retest-rate/analyze  body { upload_ids } → 重测率统计结果
 * 文件经 tus 上传（数组顺序即分析顺序，首个文件用于识别格式与解析规格）；
 * 重测率/不良率等口径与明细见 types.ts；报告导出（CSV / HTML）在客户端完成。
 *
 * 统计口径（移植自 insight 数据重测率统计工具 v1.6）：
 * - 重测 SN = 曾 PASS 且曾 FAIL；不良 SN = 从未 PASS；
 * - 测试时间仅统计 PASS 记录；Station|Slot 按 SN 首条记录归属。
 */

const FORMAT_LABELS: Record<string, string> = {
  insight: 'insight / Hilo',
  dcr: 'DCR / Moose',
  atlas: 'Atlas',
  summary: 'Summary',
  unit_archive: 'Unit Archive (合并导出)',
}

const readErrorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: { detail?: string } } })?.response
  return response?.data?.detail || '处理失败，请稍后重试'
}

const KpiCell: React.FC<{ label: string; value: string; hint?: string }> = ({
  hint,
  label,
  value,
}) => (
  <div className="rounded-lg border bg-muted/30 px-4 py-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
  </div>
)

interface ReasonEditorProps {
  reasons: ReasonMap
  kind: 'retest' | 'defect'
  itemName: string
  sn: string
  onChange: (key: string, value: string) => void
}

const ReasonEditor: React.FC<ReasonEditorProps> = ({
  kind,
  itemName,
  onChange,
  reasons,
  sn,
}) => {
  const key = reasonKey(kind, itemName, sn)
  return (
    <Textarea
      value={reasons[key] ?? '待分析'}
      onChange={(event) => onChange(key, event.target.value)}
      rows={1}
      className="min-h-8 field-sizing-content text-xs"
      aria-label={`SN ${sn} 原因分析`}
    />
  )
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
      const uploadIds: string[] = []
      for (let i = 0; i < files.length; i++) {
        setBusyLabel(`正在上传 ${i + 1}/${files.length}：${files[i].name}`)
        uploadIds.push(await upload({ file: files[i] }))
      }
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

  const handleExportCsv = () => {
    if (result) exportCsvReport(result, reasons)
  }

  const handleExportHtml = () => {
    if (result) exportHtmlReport(result, reasons)
  }

  const kpi = result
    ? {
        input: result.overview.find((row) => row.key === 'ov_input_count'),
        retest: result.overview.find((row) => row.key === 'ov_retest_rate'),
        defect: result.overview.find((row) => row.key === 'ov_defect_rate'),
      }
    : null

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

      {result && kpi?.input && kpi.retest && kpi.defect ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                数据概览
                <Badge variant="secondary">
                  {FORMAT_LABELS[result.csv_format] ?? result.csv_format}
                </Badge>
              </CardTitle>
              <CardDescription className="whitespace-pre-line">
                {`站名：${result.station_info}　版本：${result.version_info}　文件数：${result.file_count}　数据行数：${result.total_rows}`}
              </CardDescription>
              <CardAction className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExportCsv}>
                  <FileSpreadsheet />
                  导出 CSV
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportHtml}>
                  <FileCode />
                  导出 HTML
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCell label="投入数（SN）" value={String(kpi.input.value)} />
                <KpiCell
                  label="重测率"
                  value={formatRate(kpi.retest.rate)}
                  hint={`重测 SN ${kpi.retest.value} 个`}
                />
                <KpiCell
                  label="不良率"
                  value={formatRate(kpi.defect.rate)}
                  hint={`不良 SN ${kpi.defect.value} 个`}
                />
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/2">指标</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">占比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.overview.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>{OVERVIEW_LABELS[row.key] ?? row.key}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.value}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRate(row.rate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>测试时间统计</CardTitle>
              <CardDescription>仅统计 PASS 记录（EndTime − StartTime），单位：秒</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>指标</TableHead>
                    <TableHead className="text-right">秒</TableHead>
                    <TableHead>SN</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.time_stats.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>{TIME_LABELS[row.key] ?? row.key}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.seconds.toFixed(2)}
                      </TableCell>
                      <TableCell>{row.sn ?? ''}</TableCell>
                      <TableCell>{row.status ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>重测次数统计</CardTitle>
              <CardDescription>按每个 SN 最后一次 PASS 前的测试次数分档</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>档位</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">占比</TableHead>
                    <TableHead>SN 列表</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.retest_stats.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>{RETEST_STAT_LABELS[row.key] ?? row.key}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRate(row.rate)}
                      </TableCell>
                      <TableCell className="break-all text-xs text-muted-foreground">
                        {row.sn_list.join(' ')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Station 和 Slot 分析</CardTitle>
              <CardDescription>按 SN 首条记录归属机台与穴位，按不良率降序</CardDescription>
            </CardHeader>
            <CardContent>
              {result.station_slot.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>机台</TableHead>
                      <TableHead>穴位</TableHead>
                      <TableHead className="text-right">投入 SN</TableHead>
                      <TableHead className="text-right">重测 SN</TableHead>
                      <TableHead className="text-right">重测率</TableHead>
                      <TableHead className="text-right">不良 SN</TableHead>
                      <TableHead className="text-right">不良率</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.station_slot.map((row) => (
                      <TableRow key={`${row.station_id}|${row.slot_id}`}>
                        <TableCell>{row.station_id}</TableCell>
                        <TableCell>{row.slot_id}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.total_sn}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.retest_sn}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRate(row.retest_rate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.pure_fail_sn}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRate(row.pure_fail_rate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">无数据</p>
              )}
            </CardContent>
          </Card>

          <DetailSection
            title="重测项目详细分析"
            description="最终 PASS 的 SN，按测试项分组；点击原因分析可编辑，随报告导出。"
            kind="retest"
            items={result.retest_details}
            reasons={reasons}
            onReasonChange={handleReasonChange}
          />

          <DetailSection
            title="不良项目详细分析"
            description="从未 PASS 的 SN，按测试项分组，展示第一次 FAIL 后前三次测试值。"
            kind="defect"
            items={result.defect_details}
            reasons={reasons}
            onReasonChange={handleReasonChange}
          />
        </>
      ) : null}
    </div>
  )
}

interface DetailSectionProps {
  title: string
  description: string
  kind: 'retest' | 'defect'
  items: RetestItemDetail[] | DefectItemDetail[]
  reasons: ReasonMap
  onReasonChange: (key: string, value: string) => void
}

const DetailSection: React.FC<DetailSectionProps> = ({
  description,
  items,
  kind,
  onReasonChange,
  reasons,
  title,
}) => {
  if (items.length === 0) {
    return null
  }
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <Separator />
      {items.map((item) => (
        <Card key={item.name}>
          <CardHeader>
            <CardTitle className="text-sm">{item.name}</CardTitle>
            <CardDescription>
              {item.count} 个 SN（项内占比 {formatRate(item.rate)}）　规格：{item.spec}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {kind === 'retest' ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SN</TableHead>
                    <TableHead>第一次 FAIL</TableHead>
                    <TableHead>机台 / 穴位</TableHead>
                    <TableHead>第二次 FAIL</TableHead>
                    <TableHead>机台 / 穴位</TableHead>
                    <TableHead>最终 PASS</TableHead>
                    <TableHead>机台 / 穴位</TableHead>
                    <TableHead className="w-40">原因分析</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(item as RetestItemDetail).rows.map((row) => (
                    <TableRow key={row.sn}>
                      <TableCell className="font-medium">{row.sn}</TableCell>
                      <TableCell className="tabular-nums">{row.first_fail_value}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.first_fail_station} / {row.first_fail_slot}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.second_fail_value}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.second_fail_station} / {row.second_fail_slot}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.pass_value}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.pass_station} / {row.pass_slot}
                      </TableCell>
                      <TableCell>
                        <ReasonEditor
                          reasons={reasons}
                          kind={kind}
                          itemName={item.name}
                          sn={row.sn}
                          onChange={onReasonChange}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SN</TableHead>
                    <TableHead>第一次 FAIL</TableHead>
                    <TableHead>机台 / 穴位</TableHead>
                    <TableHead>第二次测试</TableHead>
                    <TableHead>机台 / 穴位</TableHead>
                    <TableHead>第三次测试</TableHead>
                    <TableHead>机台 / 穴位</TableHead>
                    <TableHead className="w-40">原因分析</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(item as DefectItemDetail).rows.map((row) => (
                    <TableRow key={row.sn}>
                      <TableCell className="font-medium">{row.sn}</TableCell>
                      <TableCell className="tabular-nums">{row.first_fail_value}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.first_fail_station} / {row.first_fail_slot}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.second_test_value}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.second_test_station} / {row.second_test_slot}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.third_test_value}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.third_test_station} / {row.third_test_slot}
                      </TableCell>
                      <TableCell>
                        <ReasonEditor
                          reasons={reasons}
                          kind={kind}
                          itemName={item.name}
                          sn={row.sn}
                          onChange={onReasonChange}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

export default RetestRateTool
