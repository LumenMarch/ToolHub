import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import {
  App as AntApp,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Drawer,
  Dropdown,
  Flex,
  Grid,
  Layout,
  Menu,
  Tag,
  theme,
  Typography,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  AppstoreOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/auth-context'
import { usePermission } from '../../features/auth/use-permission'
import { useVisibleTools } from '../../features/dashboard/use-visible-tools'
import { BrandMark } from './brand-mark'
import { NotificationBell } from './notification-bell'
import { ThemeMenu } from './theme-menu'

const { Header, Sider, Content } = Layout
const { Text } = Typography

function buildMenuItems(
  tools: Array<{ path: string; name: string; icon: ComponentType }>,
  isAdmin: boolean,
): MenuProps['items'] {
  return [
    { key: '/', icon: <AppstoreOutlined />, label: '工作台' },
    {
      type: 'group',
      label: '工具',
      children: tools.map((tool) => ({
        key: tool.path,
        icon: <tool.icon />,
        label: tool.name,
      })),
    },
    ...(isAdmin
      ? [
          { type: 'divider' as const },
          {
            type: 'group' as const,
            label: '管理',
            children: [
              { key: '/admin', icon: <SettingOutlined />, label: '管理控制台' },
            ],
          },
        ]
      : []),
  ]
}

export function AppShell() {
  const { token } = theme.useToken()
  const { message } = AntApp.useApp()
  const { user, logout } = useAuth()
  const { isAdmin } = usePermission()
  const { tools } = useVisibleTools()
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const isMobile = screens.lg === false
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const activeTool = useMemo(
    () => tools.find((tool) => location.pathname.startsWith(tool.path)),
    [location.pathname, tools],
  )

  const selectedKey = location.pathname.startsWith('/admin')
    ? '/admin'
    : activeTool?.path ?? '/'

  const breadcrumbItems = activeTool
    ? [{ title: '工作台' }, { title: activeTool.name }]
    : location.pathname.startsWith('/admin')
      ? [{ title: '管理控制台' }]
      : [{ title: '工作台' }]

  const menuItems = useMemo(
    () => buildMenuItems(tools, isAdmin),
    [isAdmin, tools],
  )

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key)
    setMobileOpen(false)
  }

  const userMenu: MenuProps['items'] = [
    {
      key: 'account',
      icon: <UserOutlined />,
      label: (
        <div>
          <Text strong style={{ display: 'block', fontSize: 13 }}>
            {user?.username}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {user?.roles.length ? user.roles.join(' · ') : '未分配角色'}
          </Text>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    ...(isAdmin
      ? [{ key: 'admin', icon: <ToolOutlined />, label: '管理控制台' }]
      : []),
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ]

  const handleUserMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'admin') {
      navigate('/admin')
      return
    }
    if (key === 'logout') {
      void logout().then(() => {
        message.success('已退出登录')
        navigate('/login')
      })
    }
  }

  const navigation = (
    <Menu
      mode="inline"
      items={menuItems}
      selectedKeys={[selectedKey]}
      onClick={handleMenuClick}
      style={{ borderInlineEnd: 'none', background: 'transparent' }}
    />
  )

  if (!user) return null

  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      {!isMobile ? (
        <Sider
          className="app-sider"
          collapsible
          collapsed={collapsed}
          trigger={null}
          width={232}
          collapsedWidth={72}
          theme="light"
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            position: 'sticky',
            top: 0,
            height: '100vh',
          }}
        >
          <BrandMark collapsed={collapsed} />
          <div className="sider-menu">{navigation}</div>
          <div
            style={{
              padding: collapsed ? '12px 0' : '12px 16px',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              textAlign: collapsed ? 'center' : 'left',
            }}
          >
            {collapsed ? (
              <Badge status="processing" />
            ) : (
              <Flex align="center" justify="space-between" gap={8}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  AntD 重构版
                </Text>
                <Tag bordered={false} style={{ marginInlineEnd: 0, fontSize: 10 }}>
                  {tools.length} 个工具
                </Tag>
              </Flex>
            )}
          </div>
        </Sider>
      ) : null}

      <Layout style={{ background: 'transparent' }}>
        <Header
          style={{
            height: 60,
            lineHeight: 'normal',
            padding: isMobile ? '0 12px' : '0 20px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <Button
            type="text"
            shape="circle"
            aria-label="切换导航"
            icon={isMobile || collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => (isMobile ? setMobileOpen(true) : setCollapsed(!collapsed))}
          />
          {isMobile ? <BrandMark compact /> : <Breadcrumb items={breadcrumbItems} />}
          <div style={{ flex: 1 }} />
          <NotificationBell />
          <ThemeMenu />
          <Dropdown
            menu={{ items: userMenu, onClick: handleUserMenu }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button type="text" style={{ height: 40, paddingInline: 6 }}>
              <Flex align="center" gap={8}>
                <Avatar
                  size={28}
                  style={{
                    background: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {user.username.slice(0, 1).toUpperCase()}
                </Avatar>
                <span className="header-username">{user.username}</span>
              </Flex>
            </Button>
          </Dropdown>
        </Header>

        <Content style={{ padding: isMobile ? 16 : 24 }}>
          <div className="page-container">
            <Outlet />
          </div>
        </Content>
      </Layout>

      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        placement="left"
        width={272}
        closable={false}
        styles={{ body: { padding: 0 } }}
      >
        <BrandMark />
        {navigation}
      </Drawer>
    </Layout>
  )
}
