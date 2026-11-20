import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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
  AuditOutlined,
  DashboardOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/auth-context'
import { usePermission } from '../../features/auth/use-permission'
import { usePendingApprovalCount } from '../../features/admin/use-pending-count'
import { BrandMark } from './brand-mark'
import { NotificationBell } from './notification-bell'
import { ThemeMenu } from './theme-menu'

const { Header, Sider, Content } = Layout
const { Text } = Typography

interface AdminMenuItem {
  key: string
  icon: ReactNode
  label: string
  permission: string
}

const ADMIN_MENU: AdminMenuItem[] = [
  { key: '/admin', icon: <DashboardOutlined />, label: '管理概览', permission: 'stats:read' },
  { key: '/admin/users', icon: <TeamOutlined />, label: '用户管理', permission: 'user:read' },
  { key: '/admin/roles', icon: <SafetyCertificateOutlined />, label: '角色与权限', permission: 'role:read' },
  { key: '/admin/audit', icon: <AuditOutlined />, label: '审计日志', permission: 'audit:read' },
  { key: '/admin/tools', icon: <ToolOutlined />, label: '工具目录', permission: 'tool_meta:read' },
  { key: '/admin/llm', icon: <RobotOutlined />, label: '模型服务', permission: 'llm_config:read' },
]

const PAGE_LABELS: Record<string, string> = {
  '/admin': '管理概览',
  '/admin/users': '用户管理',
  '/admin/roles': '角色与权限',
  '/admin/audit': '审计日志',
  '/admin/tools': '工具目录',
  '/admin/llm': '模型服务',
}

export function AdminShell() {
  const { token } = theme.useToken()
  const { message } = AntApp.useApp()
  const { user, logout } = useAuth()
  const { has } = usePermission()
  const pendingCount = usePendingApprovalCount()
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const isMobile = screens.lg === false
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const currentLabel = PAGE_LABELS[location.pathname] ?? '管理控制台'

  const menuItems = useMemo<MenuProps['items']>(() => {
    return ADMIN_MENU.filter((item) => has(item.permission)).map((item) => ({
      key: item.key,
      icon: item.icon,
      label:
        item.key === '/admin/users' && pendingCount > 0 ? (
          <Flex align="center" justify="space-between" gap={8}>
            <span>{item.label}</span>
            <Badge count={pendingCount} size="small" />
          </Flex>
        ) : (
          item.label
        ),
    }))
  }, [has, pendingCount])

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key)
    setMobileOpen(false)
  }

  const userMenu: MenuProps['items'] = [
    {
      key: 'account',
      icon: <SettingOutlined />,
      label: (
        <div>
          <Text strong style={{ display: 'block', fontSize: 13 }}>
            {user?.username}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {user?.roles.join(' · ') || '管理账号'}
          </Text>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    { key: 'home', icon: <HomeOutlined />, label: '返回工具台' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ]

  const handleUserMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'home') {
      navigate('/')
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
      selectedKeys={[location.pathname]}
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
          <BrandMark collapsed={collapsed} subtitle="管理控制台" />
          <div className="sider-menu">{navigation}</div>
          <div
            style={{
              padding: collapsed ? '12px 0' : '12px 16px',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            {collapsed ? (
              <Button
                type="text"
                shape="circle"
                aria-label="返回工具台"
                icon={<HomeOutlined />}
                onClick={() => navigate('/')}
              />
            ) : (
              <Button block type="text" icon={<HomeOutlined />} onClick={() => navigate('/')}>
                返回工具台
              </Button>
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
          {isMobile ? (
            <BrandMark compact subtitle="管理控制台" />
          ) : (
            <Breadcrumb items={[{ title: '管理控制台' }, { title: currentLabel }]} />
          )}
          <div style={{ flex: 1 }} />
          <Tag color="purple" bordered={false} style={{ marginInlineEnd: 0 }}>
            管理
          </Tag>
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
          <div className="page-container" style={{ maxWidth: 1600 }}>
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
        <BrandMark subtitle="管理控制台" />
        {navigation}
      </Drawer>
    </Layout>
  )
}
