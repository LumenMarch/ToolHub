import { Link, useLocation } from 'react-router-dom'
import { Compass, Home } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

/**
 * 未知路由兜底页。挂载于用户 Layout 与控制台 AdminLayout 两处，
 * 页面标题由各自 Layout 根据路由设置（见 Layout.tsx）。
 */
const NotFound: React.FC = () => {
  const location = useLocation()

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Compass />
        </EmptyMedia>
        <EmptyTitle>页面不存在</EmptyTitle>
        <EmptyDescription>
          没有找到「{location.pathname}」对应的页面，链接可能已过期，或对应工具已被停用。
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" size="sm">
          <Link to="/">
            <Home data-icon="inline-start" />
            返回工具台
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export default NotFound
