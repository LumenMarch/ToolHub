import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toolsConfig } from '../config/tools';
import { gsap } from 'gsap';
import { ArrowUpRight } from '@phosphor-icons/react';

const Dashboard: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.from('.tool-item', {
        x: -40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'expo.out',
        delay: 0.2
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="w-full flex flex-col justify-center min-h-[60vh]">
      <div className="flex flex-col gap-0 w-full max-w-5xl">
        {toolsConfig.map((tool, index) => {
          return (
            <Link
              key={tool.id}
              to={tool.path}
              className="tool-item group relative block px-4 py-8 border-b border-border hover:border-primary transition-colors duration-500 overflow-hidden md:px-8"
            >
              {/* 悬停时显示满版强调色。 */}
              <div className="absolute inset-0 bg-primary translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-[cubic-bezier(0.85,0,0.15,1)] z-0"></div>

              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 group-hover:text-primary-foreground transition-colors duration-300">
                <div className="flex items-baseline gap-6">
                  <span className="text-[12px] font-mono tracking-[0.2em] opacity-40 group-hover:opacity-80 transition-opacity">0{index + 1}</span>
                  <h3 className="text-3xl md:text-5xl font-bold tracking-tighter uppercase group-hover:-translate-y-1 transition-transform duration-500">
                    {tool.name}
                  </h3>
                </div>

                <div className="flex items-center gap-6 md:opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                  <p className="hidden lg:block text-sm font-mono tracking-wide max-w-sm text-right opacity-80">
                    {tool.description}
                  </p>
                  <ArrowUpRight weight="bold" className="w-8 h-8 md:w-12 md:h-12" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default Dashboard;
