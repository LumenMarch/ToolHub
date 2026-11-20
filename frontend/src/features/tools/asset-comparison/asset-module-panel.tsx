import { useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Input,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAssetDifferences,
  updateAssetAnnotations,
  type AssetComparisonJob,
  type AssetDifferenceRecord,
  type AssetDifferenceType,
  type AssetModuleKey,
} from '../../../api/asset'
import { readApiErrorMessage } from '../../../api/errors'
import {
  ASSET_DIFFERENCE_TYPE_LABELS,
  ASSET_MODULE_LABELS,
  ASSET_REVIEW_OPTIONS,
} from './constants'

const { Text } = Typography
const PAGE_SIZE = 40

const CHANGE_COLORS: Record<AssetDifferenceRecord['changeType'], string> = {
  new: 'blue',
  removed: 'red',
  anomaly: 'orange',
  custodianNew: 'purple',
  custodianRemoved: 'purple',
  deptNew: 'cyan',
  deptRemoved: 'cyan',
}

export function AssetModulePanel({
  job,
  moduleKey,
}: {
  job: AssetComparisonJob
  moduleKey: AssetModuleKey
}) {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const result = job.results.find((item) => item.key === moduleKey)
  const ready = result?.status === 'ready'
  const readOnly = job.status === 'complete' && job.finalizedRevision === job.annotationRevision
  const savedRemark = (job.remarks[moduleKey] ?? '').trim()

  const [type, setType] = useState<AssetDifferenceType>('all')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AssetDifferenceRecord | null>(null)
  const [reviewValue, setReviewValue] = useState(job.reviews[moduleKey] ?? '')
  const [remark, setRemark] = useState(job.remarks[moduleKey] ?? '')

  const diffQuery = useQuery({
    queryKey: ['asset-diff', job.jobId, moduleKey, type, search, page],
    queryFn: () =>
      getAssetDifferences({
        jobId: job.jobId,
        moduleKey,
        type,
        query: search,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      updateAssetAnnotations(
        job.jobId,
        job.annotationRevision,
        { ...job.remarks, [moduleKey]: remark.trim() },
        { ...job.reviews, [moduleKey]: reviewValue },
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(['asset', 'job', job.jobId], updated)
      message.success('模块复核已保存')
    },
    onError: (error) => {
      message.error(readApiErrorMessage(error) ?? '保存失败，请刷新后重试')
    },
  })

  const columns: TableProps<AssetDifferenceRecord>['columns'] = [
    {
      title: '类型',
      dataIndex: 'changeType',
      width: 112,
      render: (value: AssetDifferenceRecord['changeType']) => (
        <Tag color={CHANGE_COLORS[value]} bordered={false}>
          {ASSET_DIFFERENCE_TYPE_LABELS[value]}
        </Tag>
      ),
    },
    {
      title: '资产 / 设备编号',
      dataIndex: 'identifier',
      width: 156,
      render: (value: string) => <span className="mono">{value}</span>,
    },
    { title: '名称', dataIndex: 'name', width: 150, ellipsis: true },
    { title: '保管人 / DRI', dataIndex: 'owner', width: 160, ellipsis: true },
    { title: '差异维度', dataIndex: 'dimension', width: 110 },
    { title: '说明', dataIndex: 'detail', ellipsis: true },
  ]

  if (!ready) {
    return (
      <Card variant="outlined">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`${ASSET_MODULE_LABELS[moduleKey]} 尚未完成核对`}
        />
      </Card>
    )
  }

  return (
    <Flex vertical gap={14}>
      <Card
        variant="outlined"
        title={`模块复核 · ${ASSET_MODULE_LABELS[moduleKey]}`}
        extra={
          result.has_diff ? (
            savedRemark ? (
              <Tag
                color={remark.trim() === savedRemark ? 'success' : 'gold'}
                bordered={false}
              >
                {remark.trim() === savedRemark ? '备注已填写' : '备注未保存'}
              </Tag>
            ) : (
              <Tag color="gold" bordered={false}>
                有差异，归档前需填写备注
              </Tag>
            )
          ) : (
            <Tag color="success" bordered={false}>
              无差异
            </Tag>
          )
        }
      >
        <Flex vertical gap={12}>
          {readOnly ? (
            <Alert type="success" showIcon message="该模块已随任务归档，复核内容只读。" />
          ) : null}
          {result.has_diff && !remark.trim() ? (
            <Alert type="warning" showIcon message="该模块存在差异，备注为空时无法生成完整归档包。" />
          ) : null}
          <Flex gap={12} wrap>
            <Radio.Group
              value={reviewValue}
              disabled={readOnly}
              onChange={(event) => setReviewValue(event.target.value)}
              options={ASSET_REVIEW_OPTIONS}
              optionType="button"
              buttonStyle="solid"
            />
            <Button
              type="primary"
              loading={saveMutation.isPending}
              disabled={readOnly}
              onClick={() => saveMutation.mutate()}
            >
              保存复核
            </Button>
          </Flex>
          <Input.TextArea
            value={remark}
            disabled={readOnly}
            onChange={(event) => setRemark(event.target.value)}
            rows={3}
            placeholder="填写差异原因、处理方式或关联工单；有差异的模块必填。"
            showCount
            maxLength={2000}
          />
        </Flex>
      </Card>

      <Card
        variant="outlined"
        title="差异明细"
        extra={
          diffQuery.data ? (
            <Space size={6} wrap>
              <Text type="secondary" style={{ fontSize: 11 }}>
                共 {diffQuery.data.filteredTotal} 条
              </Text>
              <Tag bordered={false}>新增 {diffQuery.data.totals.new}</Tag>
              <Tag bordered={false}>移除 {diffQuery.data.totals.removed}</Tag>
              <Tag bordered={false}>异常 {diffQuery.data.totals.anomaly}</Tag>
            </Space>
          ) : null
        }
      >
        <Flex vertical gap={12}>
          <Flex gap={10} wrap>
            <Select
              value={type}
              onChange={(value) => {
                setType(value)
                setPage(0)
              }}
              options={(Object.keys(ASSET_DIFFERENCE_TYPE_LABELS) as AssetDifferenceType[]).map(
                (value) => ({ value, label: ASSET_DIFFERENCE_TYPE_LABELS[value] }),
              )}
              style={{ width: 160 }}
            />
            <Input.Search
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onSearch={(value) => {
                setSearch(value.trim())
                setPage(0)
              }}
              allowClear
              placeholder="搜索编号、名称或保管人"
              style={{ width: 280 }}
            />
          </Flex>

          {diffQuery.isError ? (
            <Alert
              type="error"
              showIcon
              message="差异明细加载失败"
              description={readApiErrorMessage(diffQuery.error) ?? '请稍后重试'}
            />
          ) : null}

          <Table<AssetDifferenceRecord>
            rowKey="id"
            columns={columns}
            dataSource={diffQuery.data?.records ?? []}
            loading={diffQuery.isFetching}
            size="middle"
            scroll={{ x: 980 }}
            onRow={(record) => ({ onClick: () => setSelected(record) })}
            pagination={{
              current: page + 1,
              pageSize: PAGE_SIZE,
              total: diffQuery.data?.filteredTotal ?? 0,
              showSizeChanger: false,
              onChange: (next) => setPage(next - 1),
            }}
          />
        </Flex>
      </Card>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        size="large"
        title="差异详情"
      >
        {selected ? (
          <Descriptions
            bordered
            size="small"
            column={1}
            items={[
              { key: 'type', label: '类型', children: <Tag color={CHANGE_COLORS[selected.changeType]} bordered={false}>{ASSET_DIFFERENCE_TYPE_LABELS[selected.changeType]}</Tag> },
              { key: 'id', label: '资产编号', children: <span className="mono">{selected.identifier}</span> },
              { key: 'name', label: '名称', children: selected.name },
              { key: 'owner', label: '保管人 / DRI', children: selected.owner },
              { key: 'dimension', label: '差异维度', children: selected.dimension },
              { key: 'source', label: '证据来源', children: selected.sourceLabel },
              { key: 'detail', label: '说明', children: selected.detail },
            ]}
          />
        ) : null}
      </Drawer>
    </Flex>
  )
}
