import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './components/ThemeProvider';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PwdGenerator from './pages/tools/PwdGenerator';
import StringAnalyzer from './pages/tools/StringAnalyzer';

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
                <Route path="/tools/pwd-generator" element={<PwdGenerator />} />
                <Route path="/tools/string-analyzer" element={<StringAnalyzer />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
