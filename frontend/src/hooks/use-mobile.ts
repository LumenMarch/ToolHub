import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // 惰性初始化取首帧真实宽度：否则窄屏会先按桌面态渲染一帧再切换，出现可见跳动
  const [isMobile, setIsMobile] = React.useState(
    () => window.innerWidth < MOBILE_BREAKPOINT,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
