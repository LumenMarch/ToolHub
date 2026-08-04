import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUsers } from './users-provider'

/** 页面主操作：新建用户（管理员直接创建，无需审批）。 */
export function UsersPrimaryButtons() {
  const { setOpen } = useUsers()
  return (
    <div className='flex gap-2'>
      <Button onClick={() => setOpen('create')}>
        <UserPlus size={16} />
        新建用户
      </Button>
    </div>
  )
}
