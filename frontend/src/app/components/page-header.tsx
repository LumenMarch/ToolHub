import type { ReactNode } from 'react'
import { Flex, Typography } from 'antd'

const { Title, Text } = Typography

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  eyebrow?: ReactNode
}

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <Flex justify="space-between" align="flex-end" wrap gap={16}>
      <div style={{ minWidth: 0 }}>
        {eyebrow ? <div style={{ marginBottom: 4 }}>{eyebrow}</div> : null}
        <Title level={3} style={{ margin: 0, letterSpacing: '-0.02em' }}>
          {title}
        </Title>
        {description ? (
          <Text type="secondary" style={{ display: 'block', marginTop: 2 }}>
            {description}
          </Text>
        ) : null}
      </div>
      {actions ? <div>{actions}</div> : null}
    </Flex>
  )
}
