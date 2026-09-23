import React, { useCallback, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { LlmCapabilities, LlmConfigResponse, LlmConfigUpdateInput } from '../../../types/llm';
import { useAdminApi } from '../hooks/use-admin-api';
import { LlmModelField } from './LlmModelField';
import { LlmThinkingField } from './LlmThinkingField';
import {
  buildPatchPayload,
  countDirtyFields,
  FIELD_GROUPS,
  initialFormValues,
  INHERIT,
  INHERIT_OPTION,
  type FieldKey,
  type FieldSpec,
} from './fields';

interface Props {
  config: LlmConfigResponse;
  /** 服务端自报能力；null = 还不知道（未探活或服务端不报） */
  capabilities: LlmCapabilities | null;
  onSaved: (next: LlmConfigResponse) => void;
}

/**
 * 运行时配置表单。
 *
 * 每个字段都是三态：留空 = 继承 env、有值 = 覆盖、从有值改成空 = 显式恢复继承。
 * 这套语义由 buildPatchPayload 统一生成，避免在组件里手搓 PATCH 体。
 */
export const LlmConfigCard: React.FC<Props> = ({ config, capabilities, onSaved }) => {
  const api = useAdminApi();
  const [values, setValues] = useState(() => initialFormValues(config.overrides));
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const overridden = useMemo(
    () => new Set(config.overriddenFields),
    [config.overriddenFields],
  );

  const dirtyCount = countDirtyFields(config.overrides, values, clearApiKey);

  const handleValueChange = useCallback((key: FieldKey, next: string) => {
    setValues((prev) => ({ ...prev, [key]: next }));
  }, []);

  const handleSave = useCallback(() => {
    const payload = buildPatchPayload({
      overrides: config.overrides,
      values,
      clearApiKey,
    });
    const invalid = FIELD_GROUPS.flatMap((group) => group.fields).find(
      (spec) =>
        spec.kind === 'number' &&
        values[spec.key] !== undefined &&
        values[spec.key] !== INHERIT &&
        !Number.isFinite(Number(values[spec.key])),
    );
    if (invalid) {
      toast.error(`「${invalid.label}」不是合法数字`);
      return;
    }
    if (!Object.keys(payload).length) {
      toast.message('没有需要保存的改动');
      return;
    }
    setSaving(true);
    api
      .patchLlmConfig(payload as LlmConfigUpdateInput)
      .then((data) => {
        onSaved(data);
        setValues(initialFormValues(data.overrides));
        setClearApiKey(false);
        toast.success(`已保存，配置版本 ${data.version}（即时生效，无需重启）`);
      })
      .catch((exc: unknown) => toast.error(readDetail(exc) ?? '保存失败'))
      .finally(() => setSaving(false));
  }, [api, clearApiKey, config.overrides, onSaved, values]);

  const handleReset = useCallback(() => {
    api
      .resetLlmConfig()
      .then((data) => {
        onSaved(data);
        setValues(initialFormValues(data.overrides));
        setClearApiKey(false);
        toast.success('已清空覆盖项，回到纯 env 配置');
      })
      .catch(() => toast.error('重置失败'));
  }, [api, onSaved]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>运行时配置</CardTitle>
        <CardDescription>
          逐字段覆盖 env 默认值，保存后立即生效；留空表示继承 env。
          {config.updated_at
            ? ` 最近由 ${config.updated_by ?? '未知'} 更新于 ${new Date(
                config.updated_at,
              ).toLocaleString()}。`
            : ''}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            disabled={saving || !overridden.size}
          >
            <RotateCcw data-icon="inline-start" />
            恢复纯 env
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !dirtyCount}>
            {saving ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            保存{dirtyCount ? `（${dirtyCount}）` : ''}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {FIELD_GROUPS.map((group) => (
          <section key={group.id} className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">{group.title}</h3>
              <p className="text-xs text-muted-foreground">{group.description}</p>
            </div>
            <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.fields.map((spec) => (
                <LlmField
                  key={spec.key}
                  spec={spec}
                  value={values[spec.key] ?? INHERIT}
                  overridden={overridden.has(spec.key)}
                  envDefault={String(config.envDefaults[spec.envKey] ?? '')}
                  apiKeySet={config.effective.apiKeySet}
                  apiKeyMask={config.effective.apiKeyMask}
                  clearApiKey={clearApiKey}
                  capabilities={capabilities}
                  onClearApiKeyChange={setClearApiKey}
                  onChange={handleValueChange}
                />
              ))}
            </FieldGroup>
          </section>
        ))}
      </CardContent>
    </Card>
  );
};

interface FieldProps {
  spec: FieldSpec;
  value: string;
  overridden: boolean;
  envDefault: string;
  apiKeySet: boolean;
  apiKeyMask: string;
  clearApiKey: boolean;
  capabilities: LlmCapabilities | null;
  onClearApiKeyChange: (next: boolean) => void;
  onChange: (key: FieldKey, value: string) => void;
}

const LlmField: React.FC<FieldProps> = ({
  spec,
  value,
  overridden,
  envDefault,
  apiKeySet,
  apiKeyMask,
  clearApiKey,
  capabilities,
  onClearApiKeyChange,
  onChange,
}) => (
  <Field>
    <FieldLabel htmlFor={spec.key} className="flex items-center gap-2">
      {spec.label}
      {overridden ? (
        <Badge variant="secondary" className="text-[10px]">
          已覆盖
        </Badge>
      ) : null}
    </FieldLabel>
    {spec.kind === 'select' ? (
      <Select
        value={value === INHERIT ? INHERIT_OPTION : value}
        onValueChange={(next) =>
          onChange(spec.key, next === INHERIT_OPTION ? INHERIT : next)
        }
      >
        <SelectTrigger id={spec.key} className="w-full">
          <SelectValue placeholder="继承 env" />
        </SelectTrigger>
        <SelectContent>
          {spec.options?.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : spec.kind === 'thinking' ? (
      <LlmThinkingField
        id={spec.key}
        value={value}
        envDefault={envDefault}
        capabilities={capabilities}
        onChange={(next) => onChange(spec.key, next)}
      />
    ) : spec.kind === 'model' ? (
      <LlmModelField
        id={spec.key}
        value={value}
        envDefault={envDefault}
        onChange={(next) => onChange(spec.key, next)}
      />
    ) : (
      <Input
        id={spec.key}
        type={
          spec.kind === 'number' ? 'number' : spec.kind === 'secret' ? 'password' : 'text'
        }
        value={value}
        placeholder={
          spec.kind === 'secret' ? (apiKeySet ? `已保存 ${apiKeyMask}` : '未设置') : envDefault
        }
        onChange={(event) => onChange(spec.key, event.target.value)}
      />
    )}
    {spec.kind === 'secret' && apiKeySet ? (
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={clearApiKey}
          onChange={(event) => onClearApiKeyChange(event.target.checked)}
        />
        清除已保存的密钥
      </label>
    ) : null}
    <p className="text-xs text-muted-foreground">{spec.hint}</p>
  </Field>
);

function readDetail(exc: unknown): string | null {
  const detail = (
    exc as { response?: { data?: { detail?: { message?: string } | string } } }
  )?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return detail?.message ?? null;
}
