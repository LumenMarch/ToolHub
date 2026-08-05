import { useContext } from 'react'
import { AuthContext } from '@/context/AuthContext'
import { UsersActionDialog } from './users-action-dialog'
import { UsersApproveDialog } from './users-approve-dialog'
import { UsersDeleteDialog } from './users-delete-dialog'
import { UsersRejectDialog } from './users-reject-dialog'
import { UsersSessionsDialog } from './users-sessions-dialog'
import { useUsers } from './users-provider'

type DialogType =
  | 'create'
  | 'edit'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'sessions'

/** 汇总渲染用户页全部弹窗（新建/编辑/删除/通过/拒绝）。 */
export function UsersDialogs() {
  const { open, setOpen, currentRow, setCurrentRow } = useUsers()
  const { user: currentUser } = useContext(AuthContext)

  /** 显式按开关状态更新弹窗，避免依赖 toggle 语义的隐式关闭。 */
  const handleOpenChange = (dialog: DialogType, next: boolean) => {
    setOpen(next ? dialog : null)
    // 仅关闭时延迟清空当前行（让关闭动画播完），并校验行 id 防止误清新选中的行
    if (!next && currentRow) {
      const rowId = currentRow.id
      setTimeout(() => {
        setCurrentRow((prev) => (prev?.id === rowId ? null : prev))
      }, 500)
    }
  }

  return (
    <>
      <UsersActionDialog
        key='user-create'
        open={open === 'create'}
        onOpenChange={(next) => handleOpenChange('create', next)}
      />

      {currentRow && (
        <>
          <UsersApproveDialog
            key={`user-approve-${currentRow.id}`}
            currentRow={currentRow}
            open={open === 'approve'}
            onOpenChange={(next) => handleOpenChange('approve', next)}
          />

          <UsersRejectDialog
            key={`user-reject-${currentRow.id}`}
            currentRow={currentRow}
            open={open === 'reject'}
            onOpenChange={(next) => handleOpenChange('reject', next)}
          />

          <UsersActionDialog
            key={`user-edit-${currentRow.id}`}
            currentRow={currentRow}
            open={open === 'edit'}
            onOpenChange={(next) => handleOpenChange('edit', next)}
            isSelf={currentUser?.id === currentRow.id}
          />

          <UsersDeleteDialog
            key={`user-delete-${currentRow.id}`}
            currentRow={currentRow}
            open={open === 'delete'}
            onOpenChange={(next) => handleOpenChange('delete', next)}
          />

          <UsersSessionsDialog
            key={`user-sessions-${currentRow.id}`}
            currentRow={currentRow}
            open={open === 'sessions'}
            onOpenChange={(next) => handleOpenChange('sessions', next)}
          />
        </>
      )}
    </>
  )
}
