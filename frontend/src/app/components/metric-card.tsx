import type { ReactNode } from 'react'
import { Card, Flex, Statistic, Tag, theme, Typography } from 'antd'

interface MetricCardProps {
  label: string
  value: number | string
  suffix?: string
  icon: ReactNode
  accent: string
  hint?: string
}

export function MetricCard({ label, value, suffix, icon, accent, hint }: MetricCardProps) {
  const { token } = theme.useToken()

  return (
    <Card variant="outlined" styles={{ body: { padding: 18 } }} style={{ height: '100%' }}>
      <Flex justify="space-between" align="flex-start" gap={12}>
        <div style={{ minWidth: 0 }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {label}
          </Typography.Text>
          <div style={{ marginTop: 6 }}>
            <Statistic
              value={value}
              suffix={suffix}
              valueStyle={{
                fontSize: 26,
                fontWeight: 650,
                letterSpacing: '-0.02em',
                color: token.colorText,
                lineHeight: 1.15,
              }}
            />
          </div>
        </div>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            display: 'grid',
            placeItems: 'center',
            background: `${accent}16`,
            color: accent,
            fontSize: 18,
            flex: '0 0 auto',
          }}
        >
          {icon}
        </div>
      </Flex>
      {hint ? (
        <div style={{ marginTop: 10 }}>
          <Tag bordered={false} style={{ marginInlineEnd: 0, fontSize: 11 }}>
            {hint}
          </Tag>
        </div>
      ) : null}
    </Card>
  )
}
