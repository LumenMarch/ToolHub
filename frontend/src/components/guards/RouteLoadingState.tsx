import React from 'react';
import { LoadingSignal } from '../LoadingSignal';
import { cn } from '../../lib/cn';

interface RouteLoadingStateProps {
  /** 全屏（守卫会话验证）还是页内（工具守卫校验） */
  fullScreen?: boolean;
  label?: string;
  detail?: string;
  meta?: string;
}

/**
 * 路由守卫统一加载态：复用 LoadingSignal 动画（与页面级 loading 同款式），
 * 避免会话验证转圈 + 懒加载 LoadingSignal 的"双重动画"割裂。
 * LoadingSignal 内部已处理 prefers-reduced-motion 降级。
 */
const RouteLoadingState: React.FC<RouteLoadingStateProps> = ({
  fullScreen = true,
  label = '[ 会话 · 验证中 ]',
  detail = '等待凭据确认',
  meta = 'Auth / Session',
}) => (
  <div
    className={cn(
      'flex w-full items-center justify-center bg-background px-8',
      fullScreen ? 'min-h-[100dvh]' : 'min-h-[40vh]',
    )}
  >
    <LoadingSignal
      ariaLabel={label}
      meta={meta}
      label={label}
      detail={detail}
      className="max-w-xl"
    />
  </div>
);

export default RouteLoadingState;
