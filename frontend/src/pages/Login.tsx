import React, { useState, useContext, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/auth-context';
import api from '../api/axios';
import { ThemeToggle } from '../components/ThemeToggle';
import { LoadingSignal } from '../components/LoadingSignal';
import { gsap } from 'gsap';
import { useHitokoto, splitIntoLines } from '../hooks/useHitokoto';

const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, user } = useContext(AuthContext);
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const { text: hitokotoText, loading: hitokotoLoading } = useHitokoto();
  const lines = hitokotoText ? splitIntoLines(hitokotoText, 3) : [];
  let lineOffset = 0;
  const displayLines = lines.map((text) => {
    const line = { id: `${lineOffset}:${text}`, text };
    lineOffset += text.length;
    return line;
  });

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  // 每日一言加载完成后只执行标题动画。
  useEffect(() => {
    if (
      !hitokotoText ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.to('.clip-text > span', {
        y: 0,
        duration: 1.2,
        stagger: 0.1,
        ease: 'power4.out',
        delay: 0.1
      });
    }, containerRef);
    return () => ctx.revert();
  }, [hitokotoText]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);
        const response = await api.post('/auth/session', formData);
        login(response.data);
        
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          navigate('/');
        } else {
          gsap.to(containerRef.current, {
            opacity: 0,
            scale: 0.95,
            duration: 0.8,
            ease: 'power3.inOut',
            onComplete: () => {
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
      
      {/* 左侧每日一言 */}
      <div className="flex-1 flex flex-col justify-center p-8 md:p-16 lg:p-24 relative z-10">
        <div className="min-h-32 w-full max-w-xl">
          {hitokotoLoading ? (
            <LoadingSignal
              ariaLabel="正在加载每日一言"
              meta="Hitokoto / Remote"
              label="[ 每日一言 · 握手中 ]"
              detail="等待远端响应"
              className="pt-4"
            />
          ) : (
            <h1
              ref={titleRef}
              className="text-3xl font-bold leading-[1.2] tracking-tight md:text-4xl lg:text-5xl"
            >
              {displayLines.map((line) => (
                <div key={line.id} className="clip-text">
                  <span>{line.text}</span>
                </div>
              ))}
            </h1>
          )}
        </div>
      </div>

      {/* 右侧极简粗野主义表单 */}
      <div className="flex-1 flex flex-col justify-center p-8 md:p-16 lg:p-24 relative z-10 form-wrapper max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-12 w-full">
          {error && (
            <div id="auth-error" role="alert" className="text-sm font-mono text-primary bg-primary/10 p-4 border-l-2 border-primary uppercase tracking-widest">
              [ 异常: {error} ]
            </div>
          )}
          
          <div className="relative group">
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
          
          <div className="relative group">
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

          <div className="pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
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
