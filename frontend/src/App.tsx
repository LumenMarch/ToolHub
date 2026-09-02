import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Suspense, lazy } from 'react'

import { AuthProvider } from './components/AuthProvider'
import { ThemeProvider } from './components/ThemeProvider'
import { LoadingSignal } from './components/LoadingSignal'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import ProtectedRoute from './components/guards/ProtectedRoute'
import AdminRoute from './components/guards/AdminRoute'
import ToolGuard from './components/guards/ToolGuard'
import Layout from './components/Layout'
import AdminLayout from './pages/admin/components/AdminLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import { toolsConfig } from './config/tools'

const SuspendFallback = () => (
  <div className="flex h-[60vh] w-full items-center justify-center">
    <LoadingSignal ariaLabel="正在装载功能模块" label="正在装载功能模块" />
  </div>
)

const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'))
const AdminUsers = lazy(() => import('./pages/admin/Users'))
const AdminAudit = lazy(() => import('./pages/admin/Audit'))
const AdminTools = lazy(() => import('./pages/admin/Tools'))
const AdminRoles = lazy(() => import('./pages/admin/Roles'))
const PendingApproval = lazy(() => import('./pages/PendingApproval'))

function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <BrowserRouter>
          <AuthProvider>
            <Toaster position="bottom-right" />
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route element={<ProtectedRoute />}>
                <Route
                  path="/pending"
                  element={
                    <Suspense fallback={<SuspendFallback />}>
                      <PendingApproval />
                    </Suspense>
                  }
                />
                <Route element={<Layout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route element={<ToolGuard />}>
                    {toolsConfig.map((tool) => {
                      const routePath =
                        tool.id === 'cpk-charts'
                          ? 'tools/cpk-charts/*'
                          : tool.path.replace(/^\//, '')
                      return (
                        <Route
                          key={tool.id}
                          path={routePath}
                          element={
                            <Suspense fallback={<SuspendFallback />}>
                              <tool.component />
                            </Suspense>
                          }
                        />
                      )
                    })}
                  </Route>
                </Route>
              </Route>

              <Route element={<AdminRoute />}>
                <Route element={<AdminLayout />}>
                  <Route
                    path="/admin"
                    element={
                      <Suspense fallback={<SuspendFallback />}>
                        <AdminDashboard />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/admin/users"
                    element={
                      <Suspense fallback={<SuspendFallback />}>
                        <AdminUsers />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/admin/audit"
                    element={
                      <Suspense fallback={<SuspendFallback />}>
                        <AdminAudit />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/admin/tools"
                    element={
                      <Suspense fallback={<SuspendFallback />}>
                        <AdminTools />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/admin/roles"
                    element={
                      <Suspense fallback={<SuspendFallback />}>
                        <AdminRoles />
                      </Suspense>
                    }
                  />
                </Route>
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
