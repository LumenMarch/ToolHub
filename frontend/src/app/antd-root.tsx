import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { useThemeMode } from './theme-context'

dayjs.locale('zh-cn')

export function AntdRoot({ children }: { children: ReactNode }) {
  const { resolved } = useThemeMode()
  const dark = resolved === 'dark'

  const themeConfig = useMemo(
    () => ({
      algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: dark ? '#818cf8' : '#4f46e5',
        colorInfo: dark ? '#818cf8' : '#4f46e5',
        colorBgLayout: dark ? '#0d0f14' : '#f4f5f7',
        colorBgContainer: dark ? '#151821' : '#ffffff',
        colorBorderSecondary: dark ? '#242936' : '#e9ebf0',
        borderRadius: 8,
        borderRadiusLG: 12,
        fontSize: 14,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      },
      components: {
        Layout: {
          headerBg: dark ? '#151821' : '#ffffff',
          siderBg: dark ? '#151821' : '#ffffff',
          bodyBg: dark ? '#0d0f14' : '#f4f5f7',
        },
        Menu: {
          itemHeight: 38,
          itemBorderRadius: 8,
          itemMarginInline: 8,
          itemMarginBlock: 2,
          groupTitleFontSize: 11,
        },
        Card: {
          borderRadiusLG: 12,
        },
        Button: {
          borderRadius: 8,
        },
        Table: {
          headerBg: dark ? '#1b1f2a' : '#f7f8fa',
        },
      },
    }),
    [dark],
  )

  return (
    <ConfigProvider
      locale={zhCN}
      theme={themeConfig}
      componentSize="medium"
      button={{ autoInsertSpace: false }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  )
}
