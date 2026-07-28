import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { cn } from '../lib/cn';

interface LoadingSignalProps {
  ariaLabel: string;
  label: string;
  detail?: string;
  meta?: string;
  compact?: boolean;
  className?: string;
}

export const LoadingSignal: React.FC<LoadingSignalProps> = ({
  ariaLabel,
  label,
  detail,
  meta,
  compact = false,
  className,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    const cursor = cursorRef.current;

    if (
      !track ||
      !cursor ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    let resizeObserver: ResizeObserver | undefined;
    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({
        repeat: -1,
        repeatDelay: compact ? 0.72 : 0.5,
      });

      timeline
        .to(cursor, {
          x: () => Math.max(0, track.clientWidth - cursor.offsetWidth),
          duration: compact ? 0.78 : 1.15,
          ease: compact ? 'power1.inOut' : 'power2.inOut',
        })
        .to(cursor, {
          opacity: 0.28,
          duration: 0.12,
          ease: 'none',
        })
        .set(cursor, { x: 0 })
        .to(cursor, {
          opacity: 1,
          duration: 0.16,
          ease: 'none',
        });

      resizeObserver = new ResizeObserver(() => {
        timeline.invalidate();
      });
      resizeObserver.observe(track);
    }, rootRef);

    return () => {
      resizeObserver?.disconnect();
      ctx.revert();
    };
  }, [compact]);

  return (
    <div
      ref={rootRef}
      role="status"
      aria-label={ariaLabel}
      className={cn('w-full font-mono', className)}
    >
      {meta && (
        <div
          aria-hidden="true"
          className={cn(
            'flex items-center justify-between gap-4 uppercase tracking-[0.2em] text-muted-foreground',
            compact ? 'text-[0.5625rem]' : 'text-[0.625rem]',
          )}
        >
          <span>{meta}</span>
          <span>Signal</span>
        </div>
      )}

      <div
        ref={trackRef}
        aria-hidden="true"
        className={cn(
          'relative w-full bg-border',
          compact ? 'mt-2 h-px' : 'mt-4 h-px',
        )}
      >
        <span
          ref={cursorRef}
          className={cn(
            'absolute left-0 top-1/2 block -translate-y-1/2 bg-primary will-change-transform',
            compact ? 'size-2' : 'size-3',
          )}
        />
      </div>

      <div
        aria-hidden="true"
        className={cn(
          'flex items-start justify-between gap-4 tracking-wider',
          compact ? 'mt-2 text-[0.625rem]' : 'mt-4 text-xs',
        )}
      >
        <span>{label}</span>
        {detail && (
          <span className="text-right text-muted-foreground">{detail}</span>
        )}
      </div>
    </div>
  );
};
