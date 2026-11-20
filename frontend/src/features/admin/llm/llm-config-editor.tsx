import { useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  Input,
  InputNumber,
  Row,
  Segmented,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { resetLlmConfig, updateLlmConfig } from '../../../api/admin'
import type { LlmConfig } from '../../../api/admin'
import { readApiErrorMessage } from '../../../api/errors'

const { Text } = Typography

type Mode = 'inherit' | 'override'
type FieldKind = 'boolean' | 'select' | 'text' | 'password' | 'number'
type FieldGroup = '连接' | '生成' | '并发与重试' | '缓存'

interface FieldDef {
  key: string
  label: string
  envKey: string
  kind: FieldKind
  group: FieldGroup
  options?: Array<{ label: string; value: string }>
  min?: number
  max?: number
  step?: number
  help?: string
}

const FIELDS: FieldDef[] = [
  { key: 'enabled', label: '启用模型服务', envKey: 'enabled', kind: 'boolean', group: '连接' },
  {
    key: 'provider',
    label: '协议',
    envKey: 'provider',
    kind: 'select',
    group: '连接',
    options: [
      { label: 'OpenAI 兼容', value: 'openai_compat' },
      { label: 'Ollama', value: 'ollama' },
    ],
  },
  { key: 'base_url', label: '服务地址', envKey: 'baseUrl', kind: 'text', group: '连接', help: '远程地址必须使用 HTTPS；内网地址需加入 LLM_ALLOWED_HOSTS。' },
  { key: 'api_key', label: 'API Key', envKey: 'apiKeySet', kind: 'password', group: '连接', help: '只保存掩码；留空表示保持当前覆盖值。' },
  { key: 'model', label: '模型名', envKey: 'model', kind: 'text', group: '连接' },
  { key: 'timeout_seconds', label: '请求超时', envKey: 'timeoutSeconds', kind: 'number', group: '连接', min: 1, max: 3600, step: 1, help: '秒' },
  { key: 'connect_timeout_seconds', label: '连接超时', envKey: 'connectTimeoutSeconds', kind: 'number', group: '连接', min: 1, max: 120, step: 1, help: '秒' },
  { key: 'max_tokens', label: '最大生成 Token', envKey: 'maxTokens', kind: 'number', group: '生成', min: 16, max: 32768, step: 16 },
  { key: 'temperature', label: 'Temperature', envKey: 'temperature', kind: 'number', group: '生成', min: 0, max: 2, step: 0.1 },
  { key: 'reasoning_effort', label: '思考强度', envKey: 'reasoningEffort', kind: 'text', group: '生成', help: '如 low / medium / high；空字符串表示显式不发送。' },
  { key: 'num_ctx', label: '上下文长度', envKey: 'numCtx', kind: 'number', group: '生成', min: 0, max: 1_048_576, step: 1024 },
  { key: 'max_concurrency', label: '最大并发', envKey: 'maxConcurrency', kind: 'number', group: '并发与重试', min: 1, max: 32, step: 1 },
  { key: 'max_queued', label: '排队上限', envKey: 'maxQueued', kind: 'number', group: '并发与重试', min: 0, max: 256, step: 1 },
  { key: 'max_retries', label: '最大重试', envKey: 'maxRetries', kind: 'number', group: '并发与重试', min: 0, max: 5, step: 1 },
  { key: 'retry_base_delay_seconds', label: '重试退避基数', envKey: 'retryBaseDelaySeconds', kind: 'number', group: '并发与重试', min: 0, max: 30, step: 0.5, help: '秒' },
  { key: 'allowed_failures', label: '熔断阈值', envKey: 'allowedFailures', kind: 'number', group: '并发与重试', min: 1, max: 20, step: 1 },
  { key: 'cooldown_seconds', label: '冷却时长', envKey: 'cooldownSeconds', kind: 'number', group: '并发与重试', min: 1, max: 3600, step: 10, help: '秒' },
  { key: 'cache_ttl_seconds', label: '缓存 TTL', envKey: 'cacheTtlSeconds', kind: 'number', group: '缓存', min: 0, max: 86_400, step: 60, help: '秒；0 表示关闭缓存' },
  { key: 'cache_max_entries', label: '缓存条目上限', envKey: 'cacheMaxEntries', kind: 'number', group: '缓存', min: 1, max: 10_000, step: 100 },
  { key: 'health_cache_ttl_seconds', label: '探活缓存 TTL', envKey: 'healthCacheTtlSeconds', kind: 'number', group: '缓存', min: 0, max: 3600, step: 10, help: '秒' },
]

const GROUPS: FieldGroup[] = ['连接', '生成', '并发与重试', '缓存']

const FIELDS_BY_GROUP = new Map<FieldGroup, FieldDef[]>()
for (const field of FIELDS) {
  const list = FIELDS_BY_GROUP.get(field.group) ?? []
  list.push(field)
  FIELDS_BY_GROUP.set(field.group, list)
}

function formatValue(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? '启用' : '关闭'
  if (typeof value === 'string') return value || '（空）'
  return String(value)
}

interface LlmConfigEditorProps {
  config: LlmConfig
  canWrite: boolean
  onSaved: () => void
}

export function LlmConfigEditor({ config, canWrite, onSaved }: LlmConfigEditorProps) {
  const { message, modal } = AntApp.useApp()
  const overridden = new Set(config.overriddenFields)
  const [modes, setModes] = useState<Record<string, Mode>>(() =>
    Object.fromEntries(
      FIELDS.map((field) => [field.key, overridden.has(field.key) ? 'override' : 'inherit']),
    ),
  )
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const field of FIELDS) {
      if (field.key === 'api_key') continue
      initial[field.key] = overridden.has(field.key)
        ? config.overrides[field.key]
        : config.envDefaults[field.envKey]
    }
    return initial
  })
  const [newApiKey, setNewApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')

  const setMode = (field: FieldDef, mode: Mode) => {
    setModes((previous) => ({ ...previous, [field.key]: mode }))
    if (mode === 'override' && field.key !== 'api_key') {
      setValues((previous) => ({
        ...previous,
        [field.key]:
          previous[field.key] ??
          config.envDefaults[field.envKey] ??
          config.effective[field.envKey as keyof LlmConfig['effective']],
      }))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const patch: Record<string, unknown> = {}
    try {
      for (const field of FIELDS) {
        const mode = modes[field.key]
        if (field.key === 'api_key') {
          if (mode === 'inherit') {
            if (overridden.has('api_key')) patch.api_key = null
          } else if (newApiKey.trim()) {
            patch.api_key = newApiKey.trim()
          }
          continue
        }
        if (mode === 'override') {
          const value = values[field.key]
          if (field.kind === 'number' && (value === null || value === undefined)) {
            throw new Error(`${field.label} 需要一个数值`)
          }
          patch[field.key] = value
        } else if (overridden.has(field.key)) {
          patch[field.key] = null
        }
      }

      if (Object.keys(patch).length === 0) {
        message.info('没有需要保存的修改')
        return
      }

      await updateLlmConfig(patch)
      message.success('模型配置已保存')
      onSaved()
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : readApiErrorMessage(saveError) ?? '保存失败，请稍后重试。',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    modal.confirm({
      title: '恢复 env 默认配置',
      content: '这会清空数据库覆盖层，所有字段回到环境变量默认值。',
      okText: '恢复默认',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setResetting(true)
        setError('')
        try {
          await resetLlmConfig()
          message.success('已恢复 env 默认配置')
          onSaved()
        } catch (resetError) {
          setError(readApiErrorMessage(resetError) ?? '恢复失败')
          throw resetError
        } finally {
          setResetting(false)
        }
      },
    })
  }

  return (
    <Flex vertical gap={14}>
      <Flex justify="space-between" align="center" wrap gap={10}>
        <Space wrap>
          <Tag color={config.effective.source === 'db' ? 'blue' : 'default'} bordered={false}>
            来源 {config.effective.source === 'db' ? '数据库覆盖' : 'env 默认'}
          </Tag>
          <Tag bordered={false}>版本 {config.version}</Tag>
          {config.updated_by ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              最后修改：{config.updated_by}
            </Text>
          ) : null}
        </Space>
        {canWrite ? (
          <Space>
            <Button danger icon={<ReloadOutlined />} loading={resetting} onClick={handleReset}>
              恢复 env 默认
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void handleSave()}
            >
              保存配置
            </Button>
          </Space>
        ) : null}
      </Flex>

      {error ? (
        <Alert type="error" showIcon closable message={error} onClose={() => setError('')} />
      ) : null}

      <Alert
        type="info"
        showIcon
        message="逐字段三态：继承 env / 覆盖 / 恢复继承"
        description="切到「覆盖」后填写值；把已覆盖字段切回「继承」会在保存时发送 null，恢复 env 默认。密钥原文永不出现在管理台。"
      />

      {GROUPS.map((group) => (
        <Card
          key={group}
          variant="outlined"
          title={group}
          styles={{ body: { padding: '4px 18px 12px' } }}
        >
          {(FIELDS_BY_GROUP.get(group) ?? []).map((field, index) => {
            const mode = modes[field.key]
            const isOverridden = overridden.has(field.key)
            return (
              <div key={field.key}>
                {index > 0 ? <Divider style={{ margin: 0 }} /> : null}
                <Row gutter={[12, 8]} align="middle" style={{ padding: '12px 0' }}>
                  <Col xs={24} md={7}>
                    <Text strong style={{ fontSize: 13 }}>
                      {field.label}
                    </Text>
                    <div>
                      <Text type="secondary" className="mono" style={{ fontSize: 10 }}>
                        {field.key}
                      </Text>
                      {field.help ? (
                        <Text type="secondary" style={{ fontSize: 10, marginLeft: 6 }}>
                          {field.help}
                        </Text>
                      ) : null}
                    </div>
                  </Col>
                  <Col xs={24} md={5}>
                    <Segmented
                      size="small"
                      value={mode}
                      disabled={!canWrite}
                      onChange={(value) => setMode(field, value as Mode)}
                      options={[
                        { label: '继承 env', value: 'inherit' },
                        { label: '覆盖', value: 'override' },
                      ]}
                    />
                  </Col>
                  <Col xs={24} md={10}>
                    {mode === 'inherit' ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        env 默认：
                        {field.key === 'api_key'
                          ? config.envDefaults.apiKeySet
                            ? '已设置'
                            : '未设置'
                          : formatValue(config.envDefaults[field.envKey])}
                      </Text>
                    ) : field.kind === 'boolean' ? (
                      <Switch
                        checked={Boolean(values[field.key])}
                        disabled={!canWrite}
                        onChange={(checked) =>
                          setValues((previous) => ({ ...previous, [field.key]: checked }))
                        }
                      />
                    ) : field.kind === 'select' ? (
                      <Segmented
                        block
                        value={String(values[field.key] ?? '')}
                        disabled={!canWrite}
                        onChange={(value) =>
                          setValues((previous) => ({ ...previous, [field.key]: value }))
                        }
                        options={field.options ?? []}
                      />
                    ) : field.kind === 'password' ? (
                      <Input.Password
                        value={newApiKey}
                        disabled={!canWrite}
                        placeholder={
                          isOverridden
                            ? `已覆盖：${String(config.overrides.api_key ?? '')}；留空保持`
                            : '输入新密钥'
                        }
                        onChange={(event) => setNewApiKey(event.target.value)}
                      />
                    ) : field.kind === 'number' ? (
                      <InputNumber
                        value={values[field.key] as number | null}
                        disabled={!canWrite}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        style={{ width: 180 }}
                        onChange={(value) =>
                          setValues((previous) => ({ ...previous, [field.key]: value }))
                        }
                      />
                    ) : (
                      <Input
                        value={String(values[field.key] ?? '')}
                        disabled={!canWrite}
                        onChange={(event) =>
                          setValues((previous) => ({
                            ...previous,
                            [field.key]: event.target.value,
                          }))
                        }
                      />
                    )}
                  </Col>
                  <Col xs={24} md={2} style={{ textAlign: 'right' }}>
                    {isOverridden ? (
                      <Tag color="blue" bordered={false} style={{ marginInlineEnd: 0 }}>
                        已覆盖
                      </Tag>
                    ) : null}
                  </Col>
                </Row>
              </div>
            )
          })}
        </Card>
      ))}

      <Text type="secondary" style={{ fontSize: 11 }}>
        保存后立即生效，不需要重启 API 或 Worker。修改地址/模型会重置熔断状态并广播刷新工具页。
        当前生效模型：<Text code>{config.effective.model || '未配置'}</Text>，并发上限{' '}
        {config.effective.maxConcurrency}，缓存 TTL {config.effective.cacheTtlSeconds}s。
      </Text>
    </Flex>
  )
}
