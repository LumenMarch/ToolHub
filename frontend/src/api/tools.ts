import { api } from './client'
import type { QrCodeLevel, QrCodeResponse, ToolMetaOverride } from './types'

export async function getToolMeta(): Promise<ToolMetaOverride[]> {
  const response = await api.get<ToolMetaOverride[]>('/tools-meta')
  return response.data
}

export interface QrCodeRequest {
  text: string
  size: number
  level: QrCodeLevel
}

export async function generateQrCode(body: QrCodeRequest): Promise<QrCodeResponse> {
  const response = await api.post<QrCodeResponse>('/tools/qrcode', body)
  return response.data
}
