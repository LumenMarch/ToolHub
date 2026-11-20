import { Alert, Card, Flex } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getLlmConfig } from '../../../api/admin'
import { usePermission } from '../../auth/use-permission'
import { adminLlmConfigQueryKey, adminLlmStatusQueryKey } from '../query-keys'
import { LlmConfigEditor } from './llm-config-editor'

export function LlmConfigPanel() {
  const queryClient = useQueryClient()
  const { has } = usePermission()
  const configQuery = useQuery({
    queryKey: adminLlmConfigQueryKey,
    queryFn: getLlmConfig,
    staleTime: 30_000,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: adminLlmConfigQueryKey })
    void queryClient.invalidateQueries({ queryKey: adminLlmStatusQueryKey })
  }

  if (configQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="模型配置加载失败"
        description="请确认当前账号拥有 llm_config:read 权限。"
      />
    )
  }

  if (configQuery.isPending || !configQuery.data) {
    return <Card variant="outlined" loading />
  }

  return (
    <Flex vertical gap={14}>
      <LlmConfigEditor
        key={configQuery.data.version}
        config={configQuery.data}
        canWrite={has('llm_config:write')}
        onSaved={invalidate}
      />
    </Flex>
  )
}
