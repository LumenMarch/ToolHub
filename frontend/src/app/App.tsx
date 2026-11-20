import { lazy, Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AntdRoot } from './antd-root'
import { queryClient } from './query-client'
import { ThemeModeProvider } from './theme-mode'
import { RouteFallback } from './components/route-fallback'
import { ErrorBoundary } from './components/error-boundary'
import { NotFoundPage } from './components/not-found-page'
import { ToolMigrationPlaceholder } from './components/tool-migration-placeholder'
import { AppShell } from './layout/app-shell'
import { AdminShell } from './layout/admin-shell'
import { RequireAuth } from './guards/require-auth'
import { RequireAdmin } from './guards/require-admin'
import { RequireTool } from './guards/require-tool'
import { RequirePermission } from './guards/require-permission'
import { AuthProvider } from '../features/auth/auth-provider'
import { TOOL_BY_ID, TOOL_CATALOG } from '../features/dashboard/tool-catalog'

const LoginPage = lazy(() =>
  import('../features/auth/login-page').then((module) => ({ default: module.LoginPage })),
)
const PendingPage = lazy(() =>
  import('../features/auth/pending-page').then((module) => ({ default: module.PendingPage })),
)
const DashboardPage = lazy(() =>
  import('../features/dashboard/dashboard-page').then((module) => ({
    default: module.DashboardPage,
  })),
)
const QrcodePage = lazy(() =>
  import('../features/tools/qrcode/qrcode-page').then((module) => ({
    default: module.QrcodePage,
  })),
)
const ImageToPdfPage = lazy(() =>
  import('../features/tools/image-to-pdf/image-to-pdf-page').then((module) => ({
    default: module.ImageToPdfPage,
  })),
)
const AssetComparisonPage = lazy(() =>
  import('../features/tools/asset-comparison/asset-comparison-page').then((module) => ({
    default: module.AssetComparisonPage,
  })),
)
const AdminOverviewPage = lazy(() =>
  import('../features/admin/overview/admin-overview-page').then((module) => ({
    default: module.AdminOverviewPage,
  })),
)
const AdminUsersPage = lazy(() =>
  import('../features/admin/users/admin-users-page').then((module) => ({
    default: module.AdminUsersPage,
  })),
)
const AdminRolesPage = lazy(() =>
  import('../features/admin/roles/admin-roles-page').then((module) => ({
    default: module.AdminRolesPage,
  })),
)
const AdminAuditPage = lazy(() =>
  import('../features/admin/audit/admin-audit-page').then((module) => ({
    default: module.AdminAuditPage,
  })),
)
const AdminToolsPage = lazy(() =>
  import('../features/admin/tools/admin-tools-page').then((module) => ({
    default: module.AdminToolsPage,
  })),
)
const AdminLlmPage = lazy(() =>
  import('../features/admin/llm/admin-llm-page').then((module) => ({
    default: module.AdminLlmPage,
  })),
)

const qrcodeTool = TOOL_BY_ID.get('qrcode')!
const imageToPdfTool = TOOL_BY_ID.get('image-to-pdf')!
const assetTool = TOOL_BY_ID.get('asset-comparison')!
const migrationTools = TOOL_CATALOG.filter(
  (tool) =>
    tool.id !== 'qrcode' &&
    tool.id !== 'image-to-pdf' &&
    tool.id !== 'asset-comparison',
)

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <AntdRoot>
          <BrowserRouter>
            <AuthProvider>
              <ErrorBoundary>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />

                    <Route element={<RequireAuth />}>
                      <Route path="/pending" element={<PendingPage />} />
                    </Route>

                    <Route element={<RequireAuth />}>
                      <Route element={<AppShell />}>
                        <Route index element={<DashboardPage />} />
                        <Route
                          path="/tools/qrcode"
                          element={
                            <RequireTool tool={qrcodeTool}>
                              <QrcodePage />
                            </RequireTool>
                          }
                        />
                        <Route
                          path="/tools/image-to-pdf"
                          element={
                            <RequireTool tool={imageToPdfTool}>
                              <ImageToPdfPage />
                            </RequireTool>
                          }
                        />
                        <Route
                          path="/tools/asset-comparison"
                          element={
                            <RequireTool tool={assetTool}>
                              <AssetComparisonPage />
                            </RequireTool>
                          }
                        />
                        {migrationTools.map((tool) => (
                          <Route
                            key={tool.id}
                            path={
                              tool.id === 'cpk-charts'
                                ? `${tool.path}/*`
                                : tool.path
                            }
                            element={
                              <RequireTool tool={tool}>
                                <ToolMigrationPlaceholder tool={tool} />
                              </RequireTool>
                            }
                          />
                        ))}
                        <Route path="*" element={<NotFoundPage />} />
                      </Route>

                      <Route path="/admin" element={<RequireAdmin />}>
                        <Route element={<AdminShell />}>
                          <Route
                            index
                            element={
                              <RequirePermission permission="stats:read">
                                <AdminOverviewPage />
                              </RequirePermission>
                            }
                          />
                          <Route
                            path="users"
                            element={
                              <RequirePermission permission="user:read">
                                <AdminUsersPage />
                              </RequirePermission>
                            }
                          />
                          <Route
                            path="roles"
                            element={
                              <RequirePermission permission="role:read">
                                <AdminRolesPage />
                              </RequirePermission>
                            }
                          />
                          <Route
                            path="audit"
                            element={
                              <RequirePermission permission="audit:read">
                                <AdminAuditPage />
                              </RequirePermission>
                            }
                          />
                          <Route
                            path="tools"
                            element={
                              <RequirePermission permission="tool_meta:read">
                                <AdminToolsPage />
                              </RequirePermission>
                            }
                          />
                          <Route
                            path="llm"
                            element={
                              <RequirePermission permission="llm_config:read">
                                <AdminLlmPage />
                              </RequirePermission>
                            }
                          />
                          <Route path="*" element={<NotFoundPage />} />
                        </Route>
                      </Route>
                    </Route>
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </AuthProvider>
          </BrowserRouter>
        </AntdRoot>
      </ThemeModeProvider>
    </QueryClientProvider>
  )
}
