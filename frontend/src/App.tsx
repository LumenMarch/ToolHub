import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { AuthProvider } from './components/AuthProvider';
import { ThemeProvider } from './components/ThemeProvider';
import ProtectedRoute from './components/guards/ProtectedRoute';
import AdminRoute from './components/guards/AdminRoute';
import ToolGuard from './components/guards/ToolGuard';
import Layout from './components/Layout';
import AdminLayout from './pages/admin/components/AdminLayout';
import { LoadingSignal } from './components/LoadingSignal';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { toolsConfig } from './config/tools';

// Suspense 与数据请求使用同一套信号扫描等待态。
const SuspendFallback = () => (
  <div className="flex h-[60vh] w-full items-center justify-center">
    <LoadingSignal
      ariaLabel="正在装载功能模块"
      meta="Module / Lazy Boundary"
      label="[ 功能模块 · 装载中 ]"
      detail="等待代码分片"
      className="max-w-2xl"
    />
  </div>
);

// Admin 页面懒加载，保持代码分割。
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminAudit = lazy(() => import('./pages/admin/Audit'));
const AdminTools = lazy(() => import('./pages/admin/Tools'));
const AdminRoles = lazy(() => import('./pages/admin/Roles'));
const PendingApproval = lazy(() => import('./pages/PendingApproval'));

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="toolhub-theme">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* 用户区 */}
            <Route element={<ProtectedRoute />}>
              {/* 待审批用户只能访问等待页（ProtectedRoute 会拦截其它路由） */}
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

                {/* 工具路由 — ToolGuard 拦截已禁用的工具 */}
                <Route element={<ToolGuard />}>
                  {toolsConfig.map((tool) => (
                    <Route
                      key={tool.id}
                      path={tool.path.replace(/^\//, '')}
                      element={
                        <Suspense fallback={<SuspendFallback />}>
                          <tool.component />
                        </Suspense>
                      }
                    />
                  ))}
                </Route>
              </Route>
            </Route>

            {/* 管理员区 */}
            <Route element={<AdminRoute />}>
              <Route element={<AdminLayout />}>
                <Route path="/admin" element={
                  <Suspense fallback={<SuspendFallback />}>
                    <AdminDashboard />
                  </Suspense>
                } />
                <Route path="/admin/users" element={
                  <Suspense fallback={<SuspendFallback />}>
                    <AdminUsers />
                  </Suspense>
                } />
                <Route path="/admin/audit" element={
                  <Suspense fallback={<SuspendFallback />}>
                    <AdminAudit />
                  </Suspense>
                } />
                <Route path="/admin/tools" element={
                  <Suspense fallback={<SuspendFallback />}>
                    <AdminTools />
                  </Suspense>
                } />
                <Route path="/admin/roles" element={
                  <Suspense fallback={<SuspendFallback />}>
                    <AdminRoles />
                  </Suspense>
                } />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
