import React, { useState, useContext, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/auth-context';
import api from '../api/axios';
import { ThemeToggle } from '../components/ThemeToggle';
import { gsap } from 'gsap';

const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, token } = useContext(AuthContext);
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (token) {
      navigate('/');
    }
  }, [token, navigate]);

  // 仅在用户允许动态效果时执行大标题入场。
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const ctx = gsap.context(() => {
      // 标题切片依次显现。
      gsap.to('.clip-text > span', {
        y: 0,
        duration: 1.2,
        stagger: 0.1,
        ease: 'power4.out',
        delay: 0.1
      });
      
      gsap.fromTo('.gsap-fade', 
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 1, stagger: 0.1, ease: 'power3.out', delay: 0.8 }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [isLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);
        const response = await api.post('/auth/token', formData);
        
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          login(response.data.access_token);
          navigate('/');
        } else {
          gsap.to(containerRef.current, {
            opacity: 0,
            scale: 0.95,
            duration: 0.8,
            ease: 'power3.inOut',
            onComplete: () => {
              login(response.data.access_token);
              navigate('/');
            }
          });
        }
      } else {
        await api.post('/auth/register', { username, password });
        setIsLogin(true);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          gsap.fromTo('.form-wrapper',
            { x: -20 },
            { x: 0, duration: 0.6, ease: 'expo.out' }
          );
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '系统发生错误。');
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.fromTo('.form-wrapper',
          { x: -10 },
          { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' }
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="min-h-[100dvh] bg-background flex flex-col lg:flex-row relative">
      <div className="grain-overlay" />
      
      {/* 登录页主题切换 */}
      <div className="absolute top-8 right-8 z-50  pointer-events-auto">
        <ThemeToggle />
      </div>
      
      {/* 左侧超大标题 */}
      <div className="flex-1 flex flex-col justify-center p-8 md:p-16 lg:p-24 relative z-10 ">
        <h1 ref={titleRef} className="text-6xl md:text-8xl lg:text-[10vw] font-bold tracking-tighter leading-[0.85] uppercase">
          <div className="clip-text"><span>{isLogin ? '进入' : '加入'}</span></div><br/>
          <div className="clip-text"><span>系统</span></div><br/>
          <div className="clip-text"><span className="text-primary">核心.</span></div>
        </h1>
      </div>

      {/* 右侧极简粗野主义表单 */}
      <div className="flex-1 flex flex-col justify-center p-8 md:p-16 lg:p-24 relative z-10 form-wrapper max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-12 w-full">
          {error && (
            <div id="auth-error" role="alert" className="text-sm font-mono text-primary bg-primary/10 p-4 border-l-2 border-primary gsap-fade uppercase tracking-widest">
              [ 异常: {error} ]
            </div>
          )}
          
          <div className="gsap-fade relative group">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="awwwards-input w-full"
              placeholder=" "
              autoComplete="off"
              required
              id="username"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'auth-error' : undefined}
            />
            <label htmlFor="username" className="absolute left-0 top-4 text-muted-foreground font-mono text-sm tracking-widest uppercase transition-[color,font-size,transform] duration-300 pointer-events-none group-focus-within:-translate-y-8 group-focus-within:text-[11px] group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8 [.awwwards-input:not(:placeholder-shown)~&]:text-[11px]">
              身份标识
            </label>
          </div>
          
          <div className="gsap-fade relative group">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="awwwards-input w-full font-mono tracking-widest"
              placeholder=" "
              required
              id="password"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'auth-error' : undefined}
            />
            <label htmlFor="password" className="absolute left-0 top-4 text-muted-foreground font-mono text-sm tracking-widest uppercase transition-[color,font-size,transform] duration-300 pointer-events-none group-focus-within:-translate-y-8 group-focus-within:text-[11px] group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8 [.awwwards-input:not(:placeholder-shown)~&]:text-[11px]">
              安全密钥
            </label>
          </div>

          <div className="gsap-fade pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
            <button
              type="submit"
              disabled={loading}
              className="text-4xl md:text-5xl font-bold uppercase tracking-tighter hover:text-primary transition-colors active:scale-95 origin-left"
            >
              {loading ? '等待...' : (isLogin ? '授权访问 ↗' : '创建身份 ↗')}
            </button>
            
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
              }}
              className="text-[11px] font-mono text-muted-foreground hover:text-foreground uppercase tracking-[0.2em] transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-full after:h-[1px] after:bg-muted-foreground hover:after:bg-foreground"
            >
              {isLogin ? "需要获取权限？" : "已持有身份？"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Login;
