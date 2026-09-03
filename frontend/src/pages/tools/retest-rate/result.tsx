import { FileCode, FileSpreadsheet } from 'lucide-react'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
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

const FORMAT_LABELS: Record<string, string> = {
  insight: 'insight / Hilo',
  dcr: 'DCR / Moose',
  atlas: 'Atlas',
  summary: 'Summary',
  unit_archive: 'Unit Archive (合并导出)',
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

interface OverviewCardProps {
  result: AnalyzeResult
  reasons: ReasonMap
}

const OverviewCard: React.FC<OverviewCardProps> = ({ reasons, result }) => {
  const input = result.overview.find((row) => row.key === 'ov_input_count')
  const retest = result.overview.find((row) => row.key === 'ov_retest_rate')
  const defect = result.overview.find((row) => row.key === 'ov_defect_rate')

  return (
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCsvReport(result, reasons)}
          >
            <FileSpreadsheet />
            导出 CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportHtmlReport(result, reasons)}
          >
            <FileCode />
            导出 HTML
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {input && retest && defect ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCell label="投入数（SN）" value={String(input.value)} />
            <KpiCell
              label="重测率"
              value={formatRate(retest.rate)}
              hint={`重测 SN ${retest.value} 个`}
            />
            <KpiCell
              label="不良率"
              value={formatRate(defect.rate)}
              hint={`不良 SN ${defect.value} 个`}
            />
          </div>
        ) : null}

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
  )
}

const TimeStatsCard: React.FC<{ result: AnalyzeResult }> = ({ result }) => (
  <Card>
    <CardHeader>
      <CardTitle>测试时间统计</CardTitle>
      <CardDescription>
        仅统计 PASS 记录（EndTime − StartTime），单位：秒
      </CardDescription>
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
)

const RetestBinsCard: React.FC<{ result: AnalyzeResult }> = ({ result }) => (
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
)

const StationSlotCard: React.FC<{ result: AnalyzeResult }> = ({ result }) => (
  <Card>
    <CardHeader>
      <CardTitle>Station 和 Slot 分析</CardTitle>
      <CardDescription>
        按 SN 首条记录归属机台与穴位，按不良率降序
      </CardDescription>
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
)

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
                      <TableCell className="tabular-nums">
                        {row.first_fail_value}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.first_fail_station} / {row.first_fail_slot}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.second_fail_value}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.second_fail_station} / {row.second_fail_slot}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.pass_value}
                      </TableCell>
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
                      <TableCell className="tabular-nums">
                        {row.first_fail_value}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.first_fail_station} / {row.first_fail_slot}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.second_test_value}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.second_test_station} / {row.second_test_slot}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.third_test_value}
                      </TableCell>
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

interface ResultPanelProps {
  result: AnalyzeResult
  reasons: ReasonMap
  onReasonChange: (key: string, value: string) => void
}

/** 分析结果展示区：概览、时间统计、分档、Station|Slot 与两类明细。 */
export const ResultPanel: React.FC<ResultPanelProps> = ({
  onReasonChange,
  reasons,
  result,
}) => {
  return (
    <>
      <OverviewCard reasons={reasons} result={result} />
      <TimeStatsCard result={result} />
      <RetestBinsCard result={result} />
      <StationSlotCard result={result} />
      <DetailSection
        title="重测项目详细分析"
        description="最终 PASS 的 SN，按测试项分组；点击原因分析可编辑，随报告导出。"
        kind="retest"
        items={result.retest_details}
        reasons={reasons}
        onReasonChange={onReasonChange}
      />
      <DetailSection
        title="不良项目详细分析"
        description="从未 PASS 的 SN，按测试项分组，展示第一次 FAIL 后前三次测试值。"
        kind="defect"
        items={result.defect_details}
        reasons={reasons}
        onReasonChange={onReasonChange}
      />
    </>
  )
}
