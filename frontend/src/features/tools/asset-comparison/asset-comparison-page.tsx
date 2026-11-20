import { useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Space,
  Steps,
  Tag,
  theme,
  Typography,
} from 'antd'
import {
  FileSearchOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../../app/components/page-header'
import {
  cancelAssetJob,
  getAssetJob,
  type AssetComparisonJob,
  type AssetJobStatus,
} from '../../../api/asset'
import { errorStatus, readApiErrorMessage } from '../../../api/errors'
import { useRealtimeConnected, useRealtimeEvent } from '../../../realtime/hooks'
import { AssetUploadPanel } from './asset-upload-panel'
import { AssetJobPanel } from './asset-job-panel'
import { AssetReviewPanel } from './asset-review-panel'
import { ASSET_JOB_STATUS_META } from './constants'

const { Text } = Typography
const STORAGE_KEY = 'toolhub-asset-comparison-active-job'
const JOB_EVENT_TYPES = ['job.updated', 'job.terminal'] as const

function isActiveStatus(status: AssetJobStatus | undefined): boolean {
  return Boolean(status && ASSET_JOB_STATUS_META[status]?.active)
}

export function AssetComparisonPage() {
  const { token } = theme.useToken()
  const { message, modal } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(() =>
    sessionStorage.getItem(STORAGE_KEY),
  )
  const wsConnected = useRealtimeConnected()

  const jobQuery = useQuery({
    queryKey: ['asset', 'job', jobId],
    queryFn: () => getAssetJob(jobId!),
    enabled: Boolean(jobId),
    retry: false,
    refetchInterval: (query) => {
      if (wsConnected) return false
      const status = query.state.data?.status
      return isActiveStatus(status) ? 2_000 : false
    },
  })

  useRealtimeEvent(JOB_EVENT_TYPES, (event) => {
    if (!jobId || event.tool !== 'asset-comparison' || event.job_id !== jobId) return
    void queryClient.invalidateQueries({ queryKey: ['asset', 'job', jobId] })
  })

  const cancelMutation = useMutation({
    mutationFn: () => cancelAssetJob(jobId!),
    onSuccess: () => {
      message.success('已请求取消任务')
      if (jobId) void queryClient.invalidateQueries({ queryKey: ['asset', 'job', jobId] })
    },
    onError: (error) => message.error(readApiErrorMessage(error) ?? '取消失败'),
  })

  const job = jobQuery.data
  const jobStatus = job?.status
  const meta = jobStatus ? ASSET_JOB_STATUS_META[jobStatus] : null
  const expired = jobQuery.isError && errorStatus(jobQuery.error) === 410
  const notFound = jobQuery.isError && errorStatus(jobQuery.error) === 404

  const handleJobStarted = (started: AssetComparisonJob) => {
    sessionStorage.setItem(STORAGE_KEY, started.jobId)
    setJobId(started.jobId)
    queryClient.setQueryData(['asset', 'job', started.jobId], started)
  }

  const clearJob = () => {
    if (jobId) {
      queryClient.removeQueries({ queryKey: ['asset', 'job', jobId] })
    }
    sessionStorage.removeItem(STORAGE_KEY)
    setJobId(null)
  }

  const handleNewJob = () => {
    if (meta?.active) {
      modal.confirm({
        title: '开始新的核对任务？',
        content: '当前任务仍在运行。新建任务会请求取消当前任务，已生成的文件会保留到过期。',
        okText: '取消并新建',
        cancelText: '返回',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await cancelAssetJob(jobId!)
          } catch {
            // 即使取消失败也允许离开当前视图
          }
          clearJob()
        },
      })
      return
    }
    clearJob()
  }

  const currentStep =
    !jobId
      ? 0
      : jobStatus === 'complete'
        ? 3
        : jobStatus === 'base_ready' || jobStatus === 'partial_failed' || jobStatus === 'finalizing'
          ? 2
          : 1

  const reviewable =
    jobStatus === 'base_ready' ||
    jobStatus === 'partial_failed' ||
    jobStatus === 'finalizing' ||
    jobStatus === 'complete'

  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="资产核对"
        description="对比财务、SFC、Notes 与客户账目，复核差异并生成完整归档包。"
        eyebrow={
          meta ? (
            <Space size={6}>
              <Tag color={meta.color} bordered={false}>{meta.label}</Tag>
              <Text type="secondary" className="mono" style={{ fontSize: 11 }}>
                {jobId}
              </Text>
            </Space>
          ) : (
            <Tag color="purple" bordered={false}>
              新版工作台
            </Tag>
          )
        }
        actions={
          <Space>
            {jobId ? (
              <>
                <Button
                  icon={<ReloadOutlined />}
                  loading={jobQuery.isFetching}
                  onClick={() => void jobQuery.refetch()}
                >
                  刷新
                </Button>
                <Button icon={<PlayCircleOutlined />} onClick={handleNewJob}>
                  新建任务
                </Button>
              </>
            ) : null}
          </Space>
        }
      />

      <Card variant="outlined" styles={{ body: { padding: '18px 22px' } }}>
        <Steps
          current={currentStep}
          items={[
            { title: '文件准备', description: '上传并匹配 11 个数据源' },
            { title: '核对任务', description: '7 个模块与基础文件' },
            { title: '差异复核', description: '填写原因并确认结论' },
            { title: '归档导出', description: '生成完整归档包' },
          ]}
        />
      </Card>

      {expired ? (
        <Alert
          type="warning"
          showIcon
          message="核对任务已过期"
          description="任务文件已超过保留期，请重新上传数据源并创建任务。"
          action={<Button onClick={clearJob}>重新开始</Button>}
        />
      ) : null}

      {notFound ? (
        <Alert
          type="info"
          showIcon
          message="任务不存在"
          description="本地记录的任务已不存在，可能已被清理或属于其他账号。"
          action={<Button onClick={clearJob}>重新开始</Button>}
        />
      ) : null}

      {jobQuery.isError && !expired && !notFound ? (
        <Alert
          type="error"
          showIcon
          message="核对任务加载失败"
          description={readApiErrorMessage(jobQuery.error) ?? '请稍后重试'}
          action={<Button onClick={() => void jobQuery.refetch()}>重试</Button>}
        />
      ) : null}

      {!jobId ? <AssetUploadPanel onJobStarted={handleJobStarted} /> : null}

      {jobId && jobQuery.isPending ? (
        <Card variant="outlined" loading />
      ) : null}

      {job ? (
        <>
          <AssetJobPanel
            job={job}
            refreshing={jobQuery.isFetching}
            canceling={cancelMutation.isPending}
            onRefresh={() => void jobQuery.refetch()}
            onCancel={() =>
              modal.confirm({
                title: '取消核对任务？',
                content: '取消后已生成的文件会保留到过期，但任务不能继续复核。',
                okText: '取消任务',
                cancelText: '返回',
                okButtonProps: { danger: true },
                onOk: async () => {
                  try {
                    await cancelMutation.mutateAsync()
                  } catch {
                    // mutation onError 已提示
                  }
                },
              })
            }
          />

          {job.status === 'failed' || job.status === 'cancelled' ? (
            <Alert
              type="error"
              showIcon
              message={job.status === 'failed' ? '核对任务失败' : '核对任务已取消'}
              description={job.error ?? '可以重新上传数据源后创建新任务。'}
              action={<Button onClick={handleNewJob}>重新开始</Button>}
            />
          ) : null}

          {reviewable ? <AssetReviewPanel job={job} onUpdated={() => void jobQuery.refetch()} /> : null}
        </>
      ) : null}

      {!jobId && !jobQuery.isPending ? (
        <Card variant="outlined" styles={{ body: { padding: 14 } }}>
          <Flex align="center" gap={8}>
            <FileSearchOutlined style={{ color: token.colorTextTertiary }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              上传完成后由后端匹配数据源；只有 11 个数据源全部匹配才能创建任务。
            </Text>
          </Flex>
        </Card>
      ) : null}
    </Flex>
  )
}
