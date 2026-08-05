import React, { useMemo, useState } from 'react'
import useDialogState from '@/hooks/use-dialog-state'
import { type User } from './schema'

type UsersDialogType = 'create' | 'edit' | 'delete' | 'approve' | 'reject' | 'sessions'

type UsersContextType = {
  open: UsersDialogType | null
  setOpen: (str: UsersDialogType | null) => void
  currentRow: User | null
  setCurrentRow: React.Dispatch<React.SetStateAction<User | null>>
}

const UsersContext = React.createContext<UsersContextType | null>(null)

/** 用户页弹窗全局状态：打开哪个弹窗 + 当前操作行。 */
export function UsersProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useDialogState<UsersDialogType>(null)
  const [currentRow, setCurrentRow] = useState<User | null>(null)

  // 稳定 context value，避免每次渲染重建导致所有消费方重绘
  const value = useMemo(
    () => ({ open, setOpen, currentRow, setCurrentRow }),
    [open, setOpen, currentRow],
  )

  return <UsersContext value={value}>{children}</UsersContext>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useUsers = () => {
  const usersContext = React.useContext(UsersContext)

  if (!usersContext) {
    throw new Error('useUsers has to be used within <UsersContext>')
  }

  return usersContext
}
