import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './components/ThemeProvider';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { toolsConfig } from './config/tools';

// A minimal brutalist loading spinner for Suspense fallback
const SuspendFallback = () => (
  <div className="w-full h-[60vh] flex items-center justify-center">
    <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground animate-pulse">
      [ 装载模块中... ]
    </div>
  </div>
);

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="toolhub-theme">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                
                {/* Dynamically generate routes from toolsConfig */}
                {toolsConfig.map((tool) => (
                  <Route 
                    key={tool.id} 
                    path={tool.path.replace(/^\//, '')} // remove leading slash if present for nested routing
                    element={
                      <Suspense fallback={<SuspendFallback />}>
                        <tool.component />
                      </Suspense>
                    } 
                  />
                ))}

              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
