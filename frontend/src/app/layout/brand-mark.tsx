import { Flex, Typography, theme } from 'antd'
import { ThunderboltFilled } from '@ant-design/icons'

const { Text } = Typography

interface BrandMarkProps {
  collapsed?: boolean
  compact?: boolean
  subtitle?: string
}

export function BrandMark({
  collapsed = false,
  compact = false,
  subtitle = '工具台 · 重构版',
}: BrandMarkProps) {
  const { token } = theme.useToken()

  if (compact) {
    return (
      <Flex align="center" gap={7}>
        <div
          style={{
            width: 27,
            height: 27,
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontSize: 13,
            background: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
          }}
        >
          <ThunderboltFilled />
        </div>
        <Text strong style={{ fontSize: 14, letterSpacing: '-0.01em' }}>
          ToolHub
        </Text>
      </Flex>
    )
  }

  return (
    <Flex
      align="center"
      justify={collapsed ? 'center' : 'flex-start'}
      gap={10}
      style={{ height: 72, padding: '0 18px', overflow: 'hidden' }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          display: 'grid',
          placeItems: 'center',
          flex: '0 0 auto',
          color: '#fff',
          fontSize: 17,
          background: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
          boxShadow: '0 4px 14px rgba(79, 70, 229, 0.28)',
        }}
      >
        <ThunderboltFilled />
      </div>
      {!collapsed ? (
        <div style={{ lineHeight: 1.12, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
            ToolHub
          </div>
          <Text type="secondary" style={{ fontSize: 10 }}>
            {subtitle}
          </Text>
        </div>
      ) : null}
      {!collapsed ? <span style={{ display: 'none' }}>{token.colorPrimary}</span> : null}
    </Flex>
  )
}
