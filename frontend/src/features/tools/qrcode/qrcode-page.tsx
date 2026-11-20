import { useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  Row,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  DownloadOutlined,
  QrcodeOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { PageHeader } from '../../../app/components/page-header'
import { generateQrCode } from '../../../api/tools'
import { readApiErrorMessage } from '../../../api/errors'
import type { QrCodeLevel, QrCodeResult } from '../../../api/types'

const { Text } = Typography

interface QrCodeFormValues {
  text: string
  size: number
  level: QrCodeLevel
}

export function QrcodePage() {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<QrCodeFormValues>()
  const [result, setResult] = useState<QrCodeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleGenerate = async (values: QrCodeFormValues) => {
    setLoading(true)
    setError('')
    try {
      const response = await generateQrCode(values)
      setResult(response.result)
      message.success('二维码已生成')
    } catch (generateError) {
      setError(readApiErrorMessage(generateError) ?? '生成失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!result) return
    const anchor = document.createElement('a')
    anchor.href = result.data_uri
    anchor.download = 'qrcode.png'
    anchor.click()
  }

  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="二维码生成"
        description="将文本生成可下载的二维码图片。内容不会写入审计日志。"
        actions={
          <Tag bordered={false}>
            <QrcodeOutlined /> PNG · 64–1024 px
          </Tag>
        }
      />

      {error ? (
        <Alert
          type="error"
          showIcon
          closable
          message={error}
          onClose={() => setError('')}
        />
      ) : null}

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={10}>
          <Card
            variant="outlined"
            title="参数"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>L / M / Q / H</Text>}
          >
            <Form<QrCodeFormValues>
              form={form}
              layout="vertical"
              initialValues={{ size: 256, level: 'M' }}
              onFinish={(values) => void handleGenerate(values)}
            >
              <Form.Item
                name="text"
                label="二维码内容"
                rules={[{ required: true, message: '请输入要生成二维码的文本' }]}
              >
                <Input.TextArea
                  rows={5}
                  placeholder="输入文本、URL 或任意需要编码的内容…"
                  showCount
                  maxLength={2000}
                />
              </Form.Item>

              <Form.Item name="size" label="尺寸（像素）">
                <InputNumber min={64} max={1024} step={32} style={{ width: '100%' }} />
              </Form.Item>

              <Form.Item name="level" label="纠错级别">
                <Segmented
                  block
                  options={[
                    { label: 'L · 7%', value: 'L' },
                    { label: 'M · 15%', value: 'M' },
                    { label: 'Q · 25%', value: 'Q' },
                    { label: 'H · 30%', value: 'H' },
                  ]}
                />
              </Form.Item>

              <Flex gap={10}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  icon={<QrcodeOutlined />}
                >
                  生成二维码
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    form.resetFields()
                    setResult(null)
                    setError('')
                  }}
                >
                  重置
                </Button>
              </Flex>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card
            variant="outlined"
            title="预览"
            extra={
              result ? (
                <Space>
                  <Tag color="success" bordered={false}>
                    {result.mime_type}
                  </Tag>
                  <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
                    下载 PNG
                  </Button>
                </Space>
              ) : null
            }
            style={{ height: '100%' }}
          >
            <Flex
              vertical
              align="center"
              justify="center"
              gap={14}
              style={{ minHeight: 380, padding: 20 }}
            >
              {result ? (
                <>
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 12,
                      background: '#fff',
                      border: '1px solid #eef0f4',
                    }}
                  >
                    <Image
                      src={result.data_uri}
                      alt="二维码预览"
                      width={256}
                      height={256}
                      preview
                    />
                  </div>
                  <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                    {result.text}
                  </Text>
                </>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="输入内容并生成二维码后，这里会显示预览。"
                />
              )}
            </Flex>
          </Card>
        </Col>
      </Row>
    </Flex>
  )
}
