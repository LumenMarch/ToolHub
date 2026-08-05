import { useState } from 'react'

/**
 * 确认类弹窗状态 hook：传入值相同则关闭（toggle），否则打开。
 * @example const [open, setOpen] = useDialogState<'approve' | 'reject'>()
 */
export default function useDialogState<T extends string | boolean>(
  initialState: T | null = null
) {
  const [open, setOpenState] = useState<T | null>(initialState)

  const setOpen = (value: T | null) =>
    setOpenState((prev) => (prev === value ? null : value))

  return [open, setOpen] as const
}
