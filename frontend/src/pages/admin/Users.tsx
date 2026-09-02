import React from 'react'
import { UsersProvider } from './users/users-provider'
import { UsersTable } from './users/users-table'
import { UsersDialogs } from './users/users-dialogs'
import { UsersPrimaryButtons } from './users/users-primary-buttons'
import PermissionGuard from '../../components/guards/PermissionGuard'

/** 用户管理页：审批流（待审批/通过/拒绝）+ 服务端分页表格。 */
const AdminUsers: React.FC = () => {
  return (
    <UsersProvider>
      <div className='flex flex-col gap-6'>
        <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
          <div className='flex flex-col gap-1'>
            <p className='text-sm text-muted-foreground'>
              管理系统账号、审批状态与角色
            </p>
            <p className='text-sm text-muted-foreground'>
              新注册用户需管理员审批后方可使用工具。
            </p>
          </div>
          <PermissionGuard permission='user:write'>
            <UsersPrimaryButtons />
          </PermissionGuard>
        </div>

        <UsersTable />
      </div>

      <UsersDialogs />
    </UsersProvider>
  )
}

export default AdminUsers
