import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Ban,
  BarChart3,
  FileCode,
  ImageIcon,
  RefreshCw,
} from 'lucide-react'

import api from '@/api/axios'
import FileDropZone from '@/components/FileDropZone'
import { LoadingSignal } from '@/components/LoadingSignal'
import { useTusUpload } from '@/hooks/useTusUpload'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import BoxPlotChart, {
  type BoxGroup,
  type BoxPlotChartHandle,
  type WhiskerMode,
} from './chart'
import { SearchableMultiSelect } from './searchable-multi-select'
import { SearchableSelect } from './searchable-select'

/*
 * API 契约：
 *   POST /tools/box-plot/columns    body { upload_id } → 列类型 + 前 5 行预览
 *   POST /tools/box-plot/analyze    body { upload_id, value_col, group_col? }
 *                                    → 各分组统计量（同步，无轮询）
 * 图表渲染与 SVG/PNG 导出均在客户端完成。
 *
 * 交互设计（对照 Apple HIG）：
 * - 选文件后自动上传并预填默认列（减少决策）——Direct manipulation；
 * - 上传中可取消（Progress: allow halting）；
 * - 图表直接显示在下方，更改列后自动刷新；
 * - 「更换文件」重置上传。
 */

interface ColumnMeta {
  name: string
  kind: 'numeric' | 'text' | 'other'
  nonNullCount: number
}

interface ColumnsResponse {
  filename: string
  rows: number
  sampled: boolean
  columns: ColumnMeta[]
  previewColumns: string[]
  previewRows: string[][]
  excludedRows: number
}

interface AnalyzeResponse {
  filename: string
  valueColumn: string
  groupColumn: string | null
  quartileMethod: string
  whisker: 'tukey'
  totalRows: number
  usedRows: number
  skippedRows: number
  groups: BoxGroup[]
}

type QuartileMethod = 'R7' | 'JMP'

type Phase = 'upload' | 'configure'

const NG_GROUP = '__none__'
const MAX_GROUPS = 200

const toCamel = <T extends Record<string, unknown>>(record: T): Record<string, unknown> => {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    output[camel] = value
  }
  return output
}

const readErrorMessage = (error: unknown): string => {
  const response = (error as { response?: { data?: { detail?: string } } })?.response
  return response?.data?.detail || '处理失败，请稍后重试'
}

const uploadStateLabel = (status: string): string => {
  switch (status) {
    case 'hashing':
      return '正在校验内容'
    case 'cache-checking':
      return '查找缓存'
    case 'uploading':
      return '正在上传'
    case 'confirming':
      return '完成中'
    case 'completed':
      return '已完成'
    case 'error':
      return '上传失败'
    default:
      return '准备中'
  }
}

const BoxPlotTool: React.FC = () => {
  const chartHandleRef = useRef<BoxPlotChartHandle>(null)

  const [phase, setPhase] = useState<Phase>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [columns, setColumns] = useState<ColumnsResponse | null>(null)
  const [valueColumn, setValueColumn] = useState('')
  const [groupColumn, setGroupColumn] = useState<string>(NG_GROUP)
  const [groupValueOptions, setGroupValueOptions] = useState<string[]>([])
  const [groupValueTotal, setGroupValueTotal] = useState(0)
  const [groupValuesTruncated, setGroupValuesTruncated] = useState(false)
  const [selectedGroupValues, setSelectedGroupValues] = useState<string[]>([])
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  const [whiskerMode, setWhiskerMode] = useState<WhiskerMode>('tukey')
  const [quartileMethod, setQuartileMethod] = useState<QuartileMethod>('JMP')
  const [showFences, setShowFences] = useState(false)
  const [showValues, setShowValues] = useState(false)
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [exporting, setExporting] = useState(false)
  // 请求代际计数：换文件/重置/新请求会使旧代际失效，过期响应不得提交状态
  const columnsGenRef = useRef(0)
  const analyzeGenRef = useRef(0)
  const groupValuesGenRef = useRef(0)

  const upload = useTusUpload({
    onSuccess: (uploadId) => {
      void loadColumns(uploadId)
    },
  })

  const loadColumns = useCallback(async (uploadId: string) => {
    const gen = ++columnsGenRef.current
    try {
      const response = await api.post<Record<string, unknown> & ColumnsResponse>(
        '/tools/box-plot/columns',
        { upload_id: uploadId },
      )
      if (gen !== columnsGenRef.current) return // 已被更新的选择/重置取代
      const raw = toCamel(response.data) as unknown as Record<string, unknown>
      // 嵌套数组需深层转换（columns / previewRows 等仍为 snake_case）
      if (Array.isArray(raw.columns)) {
        raw.columns = (raw.columns as Record<string, unknown>[]).map((c) => toCamel(c))
      }
      const cameled = raw as unknown as ColumnsResponse
      if (cameled.columns.length === 0) {
        setError('数据文件没有任何列')
        return
      }
      setColumns(cameled)
      const numericNames = cameled.columns
        .filter((column) => column.kind === 'numeric')
        .map((column) => column.name)
      if (numericNames.length > 0) {
        setValueColumn(numericNames[0])
        setGroupColumn(
          cameled.columns.find((column) => column.kind === 'text')?.name ?? NG_GROUP,
        )
      }
      setPhase('configure')
    } catch (err) {
      if (gen !== columnsGenRef.current) return
      // 保留上传文件与 uploadId，停留当前阶段并允许重试解析
      setError(readErrorMessage(err))
    }
  }, [])

  const handleFileSelect = useCallback(
    async (selected: File) => {
      columnsGenRef.current += 1 // 使在途的旧列解析响应失效
      analyzeGenRef.current += 1
      groupValuesGenRef.current += 1
      setFile(selected)
      setError('')
      setColumns(null)
      setAnalysis(null)
      setGroupValueOptions([])
      setSelectedGroupValues([])
      setPhase('upload')
      try {
        await upload.upload({ file: selected, metadata: { filename: selected.name } })
      } catch {
        // 错误状态已由 useTusUpload 写入
      }
    },
    [upload],
  )

  const handleCancelUpload = useCallback(() => {
    columnsGenRef.current += 1 // 取消后丢弃在途解析响应
    analyzeGenRef.current += 1
    groupValuesGenRef.current += 1
    setAnalyzing(false) // 代际失效后旧请求 finally 不再收尾，需在此清除加载态
    upload.abort()
    setFile(null)
    setError('')
  }, [upload])

  const handleReset = useCallback(() => {
    columnsGenRef.current += 1
    analyzeGenRef.current += 1
    groupValuesGenRef.current += 1
    setAnalyzing(false) // 同上：防止分析中重置后"统计计算中…"卡住
    upload.reset()
    setFile(null)
    setColumns(null)
    setAnalysis(null)
    setGroupValueOptions([])
    setSelectedGroupValues([])
    setError('')
    setPhase('upload')
  }, [upload])

  const numericColumns = useMemo(
    () => (columns?.columns ?? []).filter((column) => column.kind === 'numeric'),
    [columns],
  )

  const loadGroupValues = useCallback(async (uploadId: string, groupCol: string) => {
    const gen = ++groupValuesGenRef.current
    try {
      const response = await api.post<{
        values: string[]
        total: number
        truncated: boolean
      }>('/tools/box-plot/group-values', {
        upload_id: uploadId,
        group_col: groupCol,
      })
      if (gen !== groupValuesGenRef.current) return
      setGroupValueOptions(response.data.values)
      setGroupValueTotal(response.data.total)
      setGroupValuesTruncated(response.data.truncated)
    } catch (err) {
      if (gen !== groupValuesGenRef.current) return
      setGroupValueOptions([])
      setGroupValueTotal(0)
      setGroupValuesTruncated(false)
      setError(readErrorMessage(err))
    }
  }, [])

  const doAnalyze = useCallback(async (
    valueCol: string,
    groupCol: string,
    method: QuartileMethod,
    groupValues: string[],
  ) => {
    if (!upload.uploadId || !valueCol) return
    const gen = ++analyzeGenRef.current
    setError('')
    setAnalyzing(true)
    try {
      const response = await api.post<Record<string, unknown> & AnalyzeResponse>(
        '/tools/box-plot/analyze',
        {
          upload_id: upload.uploadId,
          value_col: valueCol,
          group_col: groupCol === NG_GROUP ? null : groupCol,
          quartile_method: method,
          group_values:
            groupCol !== NG_GROUP && groupValues.length > 0 ? groupValues : null,
        },
      )
      if (gen !== analyzeGenRef.current) return // 已有更新的分析请求，丢弃过期响应
      const rawAnalyze = toCamel(response.data) as unknown as Record<string, unknown>
      if (Array.isArray(rawAnalyze.groups)) {
        rawAnalyze.groups = (rawAnalyze.groups as Record<string, unknown>[]).map((g) => toCamel(g))
      }
      const cameled = rawAnalyze as unknown as AnalyzeResponse
      if (cameled.groups.length === 0) {
        setError('没有可绘制的数据')
        setAnalysis(null) // 无可绘数据时使旧图失效
        return
      }
      setAnalysis(cameled)
    } catch (err) {
      if (gen === analyzeGenRef.current) {
        setError(readErrorMessage(err))
        setAnalysis(null) // 失败时使旧图失效，避免展示与新选择不符的结果
      }
    } finally {
      // 仅最新一代请求有权收尾，避免旧请求提前关闭新请求的加载态
      if (gen === analyzeGenRef.current) setAnalyzing(false)
    }
  }, [upload.uploadId])

  useEffect(() => {
    if (phase !== 'configure' || !upload.uploadId || groupColumn === NG_GROUP) {
      setGroupValueOptions([])
      setGroupValueTotal(0)
      setGroupValuesTruncated(false)
      return
    }
    void loadGroupValues(upload.uploadId, groupColumn)
  }, [phase, upload.uploadId, groupColumn, loadGroupValues])

  // 列、分位或分组筛选变更后自动刷新箱线图（无需点击生成按钮）
  useEffect(() => {
    if (phase !== 'configure' || !columns || !valueColumn) return
    if (numericColumns.length === 0) return
    const grouping = groupColumn !== NG_GROUP
    if (grouping && groupValueTotal === 0 && groupValueOptions.length === 0) {
      return
    }
    const selectedCount = selectedGroupValues.length
    if (grouping && selectedCount === 0 && groupValueTotal > MAX_GROUPS) {
      setAnalysis(null)
      setError(`分组共 ${groupValueTotal} 个，超过 ${MAX_GROUPS} 上限，请先筛选分组值`)
      return
    }
    if (grouping && selectedCount > MAX_GROUPS) {
      setAnalysis(null)
      setError(`最多选择 ${MAX_GROUPS} 个分组值`)
      return
    }
    void doAnalyze(valueColumn, groupColumn, quartileMethod, selectedGroupValues)
  }, [
    phase,
    columns,
    valueColumn,
    groupColumn,
    quartileMethod,
    selectedGroupValues,
    groupValueTotal,
    groupValueOptions.length,
    numericColumns.length,
    doAnalyze,
  ])

  const handleExport = useCallback(
    async (format: 'svg' | 'png') => {
      if (!analysis || !chartHandleRef.current) return
      const baseName = `${(analysis.filename || 'boxplot').replace(/\.[^.]+$/, '')}-boxplot`
      setExporting(true)
      try {
        if (format === 'svg') {
          chartHandleRef.current.exportSvg(baseName)
        } else {
          await chartHandleRef.current.exportPng(baseName)
        }
      } catch {
        setError('导出失败，请稍后重试')
      } finally {
        setExporting(false)
      }
    },
    [analysis],
  )

  const isUploadBusy = [
    'hashing',
    'cache-checking',
    'uploading',
    'confirming',
  ].includes(upload.status)
  const isUploadDone = upload.status === 'completed' && upload.uploadId !== null

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
          {isUploadDone && phase === 'upload' ? (
            <AlertAction>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void loadColumns(upload.uploadId!)
                }}
              >
                重试解析
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ) : null}

      {phase === 'upload' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{isUploadDone ? '上传完成' : '上传数据文件'}</CardTitle>
              <CardDescription>CSV / XLSX / XLS，UTF-8 或 GB18030。</CardDescription>
              {isUploadBusy ? (
                <CardAction>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCancelUpload}
                  >
                    <Ban data-icon="inline-start" />
                    取消上传
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              <FileDropZone
                id="box-plot-file"
                label="数据文件 (CSV / XLSX / XLS)"
                description="每行一条记录；数值列可含文本脏值（自动跳过）；支持 UTF-8 与 GB18030 编码"
                accept=".csv,.xlsx,.xls"
                file={file}
                onSelect={(selected) => {
                  void handleFileSelect(selected)
                }}
                onClear={isUploadBusy ? undefined : handleReset}
                disabled={isUploadBusy}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex min-h-72 flex-col items-center justify-center">
              {isUploadBusy ? (
                <LoadingSignal
                  ariaLabel="数据文件上传中"
                  meta="Box / Upload"
                  label={`数据文件 · ${uploadStateLabel(upload.status)}`}
                  detail={
                    upload.status === 'uploading'
                      ? `${Math.round(upload.progress)}% · ${upload.bytesSent} / ${upload.bytesTotal} 字节`
                      : '正在传输数据文件'
                  }
                />
              ) : isUploadDone && phase === 'upload' ? (
                <LoadingSignal
                  ariaLabel="正在解析列"
                  meta="Box / Columns"
                  label="正在解析列类型"
                  detail="读取表头并推断数值列"
                />
              ) : upload.status === 'error' && upload.error ? (
                <Alert variant="destructive">
                  <AlertDescription>{upload.error}</AlertDescription>
                </Alert>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>等待数据</EmptyTitle>
                    <EmptyDescription>
                      上传 CSV 或 Excel 后将自动解析列类型。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {phase === 'configure' && columns ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>列配置</CardTitle>
              <CardDescription>
                {columns.filename} · {columns.rows.toLocaleString('zh-CN')} 行
                {columns.sampled ? ' · 列类型基于前 10,000 行推断' : ''}
                {columns.excludedRows > 0
                  ? ` · 已自动排除 ${columns.excludedRows} 行规格行（上限/下限/单位）`
                  : ''}
              </CardDescription>
              <CardAction>
                <Button type="button" variant="outline" size="sm" onClick={handleReset}>
                  <RefreshCw data-icon="inline-start" />
                  更换文件
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-6 md:grid-cols-2">
                  <Field>
                    <FieldLabel>数值列</FieldLabel>
                    <SearchableSelect
                      value={valueColumn}
                      onValueChange={setValueColumn}
                      options={numericColumns.map((c) => ({ value: c.name, label: c.name }))}
                      placeholder="选择数值列"
                      searchPlaceholder="搜索数值列..."
                      emptyText="无匹配数值列"
                      ariaLabel="数值列"
                    />
                    {numericColumns.length === 0 ? (
                      <Alert variant="destructive">
                        <AlertDescription>未检测到数值列</AlertDescription>
                      </Alert>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel>分组列（可选）</FieldLabel>
                    <SearchableSelect
                      value={groupColumn}
                      onValueChange={(value) => {
                        setGroupColumn(value)
                        setSelectedGroupValues([])
                      }}
                      options={[
                        { value: NG_GROUP, label: '不分组（单箱对比）' },
                        ...columns.columns.map((c) => ({ value: c.name, label: c.name })),
                      ]}
                      placeholder="选择分组列"
                      searchPlaceholder="搜索分组列..."
                      emptyText="无匹配分组列"
                      ariaLabel="分组列"
                    />
                  </Field>
                  {groupColumn !== NG_GROUP ? (
                    <Field className="md:col-span-2">
                      <FieldLabel>分组值筛选</FieldLabel>
                      <SearchableMultiSelect
                        values={selectedGroupValues}
                        onValuesChange={setSelectedGroupValues}
                        options={groupValueOptions.map((value) => ({
                          value,
                          label: value,
                        }))}
                        placeholder={`全部（${groupValueTotal.toLocaleString('zh-CN')} 个）`}
                        searchPlaceholder="搜索分组值..."
                        emptyText="无匹配分组值"
                        ariaLabel="分组值筛选"
                        disabled={groupValueOptions.length === 0}
                      />
                      {groupValuesTruncated ? (
                        <p className="text-sm text-muted-foreground">
                          仅列出前 {groupValueOptions.length} 个唯一值（共{' '}
                          {groupValueTotal.toLocaleString('zh-CN')}）。
                        </p>
                      ) : null}
                    </Field>
                  ) : null}
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>分布对比</CardTitle>
              {analysis ? (
                <CardDescription>
                  {analysis.filename} · {analysis.valueColumn}
                  {analysis.groupColumn
                    ? ` · 按 ${analysis.groupColumn} 分组`
                    : ' · 单箱对比'}{' '}
                  · 有效 {analysis.usedRows.toLocaleString('zh-CN')} /{' '}
                  {analysis.totalRows.toLocaleString('zh-CN')} 行
                  {analysis.skippedRows > 0
                    ? ` · 跳过 ${analysis.skippedRows.toLocaleString('zh-CN')} 行`
                    : ''}{' '}
                  · 分位数 {analysis.quartileMethod}
                  {analyzing ? ' · 刷新中…' : ''}
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {analyzing && !analysis ? (
                <div className="flex min-h-48 items-center justify-center">
                  <LoadingSignal
                    ariaLabel="箱线图统计计算中"
                    meta="Box / Statistics"
                    label="统计计算 · 进行中"
                    detail="按分组计算五数概括与离群点"
                  />
                </div>
              ) : analysis ? (
                <>
                  <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                    <Field className="w-fit gap-1.5">
                      <FieldLabel id="boxplot-quartile">分位</FieldLabel>
                      <ToggleGroup
                        type="single"
                        size="sm"
                        variant="outline"
                        spacing={0}
                        value={quartileMethod}
                        onValueChange={(value) => {
                          if (value === 'R7' || value === 'JMP') {
                            setQuartileMethod(value)
                          }
                        }}
                        aria-labelledby="boxplot-quartile"
                      >
                        <ToggleGroupItem value="JMP">JMP Type 6</ToggleGroupItem>
                        <ToggleGroupItem value="R7">R7（Excel）</ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                    <Separator orientation="vertical" className="hidden h-10 sm:block" />
                    <Field className="w-fit gap-1.5">
                      <FieldLabel id="boxplot-whisker">须线</FieldLabel>
                      <ToggleGroup
                        type="single"
                        size="sm"
                        variant="outline"
                        spacing={0}
                        value={whiskerMode}
                        onValueChange={(value) => {
                          if (value === 'tukey' || value === 'minmax') {
                            setWhiskerMode(value)
                          }
                        }}
                        aria-labelledby="boxplot-whisker"
                      >
                        <ToggleGroupItem value="tukey">Tukey</ToggleGroupItem>
                        <ToggleGroupItem value="minmax">Min-Max</ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                    <Separator orientation="vertical" className="hidden h-10 sm:block" />
                    <Field className="w-fit gap-1.5">
                      <FieldLabel id="boxplot-display">显示</FieldLabel>
                      <ToggleGroup
                        type="multiple"
                        size="sm"
                        variant="outline"
                        spacing={0}
                        value={[
                          ...(showFences ? ['fences'] : []),
                          ...(showValues ? ['labels'] : []),
                        ]}
                        onValueChange={(values) => {
                          setShowFences(values.includes('fences'))
                          setShowValues(values.includes('labels'))
                        }}
                        aria-labelledby="boxplot-display"
                      >
                        <ToggleGroupItem value="fences">围栏</ToggleGroupItem>
                        <ToggleGroupItem value="labels">数值</ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                    <Separator orientation="vertical" className="hidden h-10 sm:block" />
                    <Field className="w-fit gap-1.5 sm:ml-auto">
                      <FieldLabel id="boxplot-export">导出</FieldLabel>
                      <div className="flex gap-2" aria-labelledby="boxplot-export">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void handleExport('svg')
                          }}
                          disabled={exporting}
                        >
                          <FileCode data-icon="inline-start" />
                          SVG
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void handleExport('png')
                          }}
                          disabled={exporting}
                        >
                          <ImageIcon data-icon="inline-start" />
                          PNG
                        </Button>
                      </div>
                    </Field>
                  </div>
                  {analysis.groups.some(
                    (group) => group.outlierCount > group.outliers.length,
                  ) ? (
                    <p className="text-sm text-muted-foreground">
                      部分组离群点超过 500 个，图上只绘制前 500 个；完整数量见统计表。
                    </p>
                  ) : null}
                  <BoxPlotChart
                    ref={chartHandleRef}
                    groups={analysis.groups}
                    whiskerMode={whiskerMode}
                    showFences={showFences}
                    showValues={showValues}
                  />
                  <Table className="min-w-[40rem] tabular-nums">
                    <TableHeader>
                      <TableRow>
                        <TableHead>分组</TableHead>
                        <TableHead>n</TableHead>
                        <TableHead>MIN</TableHead>
                        <TableHead>Q1</TableHead>
                        <TableHead>中位数</TableHead>
                        <TableHead>Q3</TableHead>
                        <TableHead>MAX</TableHead>
                        <TableHead>IQR</TableHead>
                        <TableHead>离群点</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.groups.map((group) => (
                        <TableRow key={group.name}>
                          <TableCell
                            className="max-w-64 truncate font-medium"
                            title={group.name}
                          >
                            {group.name}
                          </TableCell>
                          <TableCell>{group.count}</TableCell>
                          <TableCell>{group.min}</TableCell>
                          <TableCell>{group.q1}</TableCell>
                          <TableCell className="text-primary">{group.median}</TableCell>
                          <TableCell>{group.q3}</TableCell>
                          <TableCell>{group.max}</TableCell>
                          <TableCell>{group.iqr}</TableCell>
                          <TableCell>
                            {group.outlierCount > 0 ? group.outlierCount : '·'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <BarChart3 className="size-4" />
                    悬停箱体查看精确统计 · 导出前请确认数据不含敏感信息
                  </p>
                </>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>等待统计</EmptyTitle>
                    <EmptyDescription>
                      选择数值列后将自动计算箱线图。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

export default BoxPlotTool
