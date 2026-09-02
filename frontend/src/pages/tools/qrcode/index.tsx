import { useState } from 'react'
import { Download } from 'lucide-react'

import api from '@/api/axios'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

interface QrcodeResult {
  mime_type: string
  text: string
  base64: string
  data_uri: string
}

const ERROR_LEVELS = [
  { value: 'L', label: 'L', detail: '约 7% 纠错' },
  { value: 'M', label: 'M', detail: '约 15% 纠错' },
  { value: 'Q', label: 'Q', detail: '约 25% 纠错' },
  { value: 'H', label: 'H', detail: '约 30% 纠错' },
] as const

const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const raw = base64.includes(',') ? base64.split(',')[1] : base64
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType || 'image/png' })
}

const QrcodeGenerator: React.FC = () => {
  const [text, setText] = useState('')
  const [size, setSize] = useState(256)
  const [level, setLevel] = useState<'L' | 'M' | 'Q' | 'H'>('M')
  const [qr, setQr] = useState<QrcodeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    if (!text.trim()) {
      setError('需要提供二维码内容')
      return
    }

    setError('')
    setLoading(true)
    setQr(null)

    try {
      const res = await api.post<{ result: QrcodeResult }>('/tools/qrcode', {
        text,
        size,
        level,
      })
      setQr(res.data.result)
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data
              ?.detail
          : undefined
      setError(detail || '系统发生错误')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!qr) {
      return
    }
    const blob = base64ToBlob(qr.base64, qr.mime_type)
    const downloadUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = `qrcode-${size}x${size}.png`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(downloadUrl)
  }

  const qrSize = Math.min(size, 512)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>参数</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={Boolean(error) || undefined}>
              <FieldLabel htmlFor="qrcode-text">二维码内容</FieldLabel>
              <Textarea
                id="qrcode-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck={false}
                aria-invalid={Boolean(error)}
                rows={6}
              />
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="qrcode-size">尺寸</FieldLabel>
              <input
                type="range"
                id="qrcode-size"
                min={64}
                max={1024}
                step={8}
                value={size}
                onChange={(event) => setSize(Number(event.target.value))}
                aria-label="二维码尺寸"
                className="w-full"
              />
              <FieldDescription>{size}px</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>纠错级别</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {ERROR_LEVELS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={level === option.value ? 'default' : 'outline'}
                    onClick={() => setLevel(option.value)}
                    aria-pressed={level === option.value}
                  >
                    {option.label}
                    <span className="text-xs opacity-70">{option.detail}</span>
                  </Button>
                ))}
              </div>
            </Field>
            <Field>
              <Button onClick={() => void handleGenerate()} disabled={loading}>
                {loading ? <Spinner data-icon="inline-start" /> : null}
                生成二维码
              </Button>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>预览</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-72 flex-col items-center justify-center">
          {loading ? (
            <Spinner />
          ) : qr ? (
            <div className="flex flex-col items-center gap-4">
              <img
                src={qr.data_uri}
                alt={`二维码：${qr.text}`}
                width={qrSize}
                height={qrSize}
                className="h-auto w-full max-w-xs object-contain"
              />
              <p className="max-w-xs truncate text-sm text-muted-foreground">
                {qr.text}
              </p>
              <Button type="button" variant="outline" onClick={handleDownload}>
                <Download data-icon="inline-start" />
                下载 PNG
              </Button>
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>等待内容</EmptyTitle>
                <EmptyDescription>输入文本后生成二维码。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default QrcodeGenerator
