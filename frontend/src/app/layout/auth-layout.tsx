import type { ReactNode } from 'react'
import { Flex, Layout, Typography, theme } from 'antd'
import { BrandMark } from '../layout/brand-mark'
import { ThemeMenu } from '../layout/theme-menu'

const { Text } = Typography

export function AuthLayout({ children }: { children: ReactNode }) {
  const { token } = theme.useToken()

  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <Flex
        vertical
        align="center"
        justify="center"
        gap={18}
        style={{ minHeight: '100vh', padding: 20 }}
      >
        <Flex
          align="center"
          justify="space-between"
          style={{ width: '100%', maxWidth: 400 }}
        >
          <BrandMark compact />
          <ThemeMenu />
        </Flex>
        {children}
        <Text type="secondary" style={{ fontSize: 11 }}>
          ToolHub · Ant Design 重构版
        </Text>
      </Flex>
    </Layout>
  )
}
