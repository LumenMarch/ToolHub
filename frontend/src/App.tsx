import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './components/ThemeProvider';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import Layout from './components/Layout';
import AdminLayout from './components/admin/AdminLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { toolsConfig } from './config/tools';

// Suspense 使用极简粗野主义加载提示。
const SuspendFallback = () => (
  <div className="w-full h-[60vh] flex items-center justify-center">
    <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground animate-pulse">
      [ 装载模块中... ]
    </div>
  </div>
);

// Admin 页面懒加载，保持代码分割。
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));
const AdminTools = lazy(() => import('./pages/admin/AdminTools'));

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="toolhub-theme">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* 用户区 */}
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />

                {/* 根据工具配置动态生成嵌套路由。 */}
                {toolsConfig.map((tool) => (
                  <Route
                    key={tool.id}
                    path={tool.path.replace(/^\//, '')} // 嵌套路由不保留开头斜杠。
                    element={
                      <Suspense fallback={<SuspendFallback />}>
                        <tool.component />
                      </Suspense>
                    }
                  />
                ))}
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
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
