import React, { useContext, useEffect, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { toolsConfig } from '../config/tools';
import { ThemeToggle } from './ThemeToggle';
import { gsap } from 'gsap';
import { ArrowRight } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const Layout: React.FC = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Entrance animation for nav
  useEffect(() => {
    gsap.fromTo(navRef.current, 
      { y: -20, opacity: 0 }, 
      { y: 0, opacity: 1, duration: 1, ease: 'expo.out', delay: 0.2 }
    );
  }, []);

  return (
    <div className="min-h-screen bg-background relative flex flex-col">
      <div className="grain-overlay" />
      
      {/* Floating Header */}
      <header ref={navRef} className="fixed top-0 left-0 w-full z-50  p-6 md:p-10 flex items-center justify-between pointer-events-none">
        <Link to="/" className="text-xl md:text-2xl font-bold tracking-tighter uppercase pointer-events-auto">
          工具<span className="text-primary">枢纽</span>.
        </Link>
        
        <div className="flex items-center gap-8 pointer-events-auto">
          <ThemeToggle />
          <span className="hidden md:block text-[13px] font-mono tracking-widest uppercase opacity-50">
            [ 标识: {user?.username} ]
          </span>
          <button
            onClick={handleLogout}
            className="text-[13px] font-mono tracking-widest uppercase hover:text-primary transition-colors relative group overflow-hidden"
          >
            <span className="relative z-10">断开连接</span>
            <div className="absolute bottom-0 left-0 w-full h-[1px] bg-primary -translate-x-[101%] group-hover:translate-x-0 transition-transform duration-500 ease-out"></div>
          </button>
        </div>
      </header>

      {/* Main Canvas - Constrained width and centered to avoid sidebar collisions */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto pt-32 md:pt-48 pb-20 px-6 md:px-24 lg:px-48 flex flex-col relative z-10">
        <Outlet />
      </main>

      {/* Floating tools index at bottom left */}
      <div className="hidden lg:flex fixed bottom-12 left-12 flex-col gap-2 z-40  w-48">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-40 mb-2">索引</p>
        {toolsConfig.map(tool => (
          <Link 
            key={tool.id} 
            to={tool.path}
            className={cn(
              "text-[12px] uppercase font-medium tracking-wider transition-all duration-500 ease-out flex items-center gap-2",
              location.pathname.includes(tool.path) ? "text-primary translate-x-2" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {location.pathname.includes(tool.path) && <ArrowRight className="w-3 h-3" />}
            {tool.name}
          </Link>
        ))}
      </div>
    </div>
  );
};

export default Layout;
