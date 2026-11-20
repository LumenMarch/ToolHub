import { Button, Dropdown, Tooltip } from 'antd'
import { BgColorsOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useThemeMode } from '../theme-context'

export function ThemeMenu() {
  const { resolved, mode, setMode } = useThemeMode()
  const icon =
    mode === 'system' ? <BgColorsOutlined /> : resolved === 'dark' ? <SunOutlined /> : <MoonOutlined />

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      menu={{
        selectedKeys: [mode],
        items: [
          { key: 'light', icon: <SunOutlined />, label: '亮色' },
          { key: 'dark', icon: <MoonOutlined />, label: '暗色' },
          { key: 'system', icon: <BgColorsOutlined />, label: '跟随系统' },
        ],
        onClick: ({ key }) => setMode(key as 'light' | 'dark' | 'system'),
      }}
    >
      <Tooltip title="切换主题">
        <Button type="text" shape="circle" aria-label="切换主题" icon={icon} />
      </Tooltip>
    </Dropdown>
  )
}
