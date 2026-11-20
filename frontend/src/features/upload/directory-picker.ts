interface PickedFileHandle {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
}

interface PickedDirectoryHandle {
  kind: 'directory'
  name: string
  values: () => AsyncIterableIterator<PickedFileHandle | PickedDirectoryHandle>
}

type DirectoryPicker = (options?: {
  mode?: 'read'
}) => Promise<PickedDirectoryHandle>

export interface PickedDirectory {
  name: string
  files: File[]
}

function isDirectoryPicker(value: unknown): value is DirectoryPicker {
  return typeof value === 'function'
}

function getDirectoryPicker(): DirectoryPicker | null {
  const candidate = Reflect.get(window, 'showDirectoryPicker')
  return isDirectoryPicker(candidate) ? candidate.bind(window) : null
}

export function supportsDirectoryPicker(): boolean {
  return getDirectoryPicker() !== null
}

export function supportsWebkitDirectory(): boolean {
  return 'webkitdirectory' in document.createElement('input')
}

async function collectDirectory(
  handle: PickedDirectoryHandle,
  files: File[],
): Promise<void> {
  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      files.push(await entry.getFile())
    } else {
      await collectDirectory(entry, files)
    }
  }
}

/**
 * 优先使用 File System Access API 打开系统目录选择器。
 * 返回 null 表示用户取消；不支持时抛错，由调用方降级到 webkitdirectory input。
 */
export async function pickDirectory(): Promise<PickedDirectory | null> {
  const picker = getDirectoryPicker()
  if (!picker) throw new Error('当前浏览器不支持目录选择器')
  try {
    const handle = await picker({ mode: 'read' })
    const files: File[] = []
    await collectDirectory(handle, files)
    return { name: handle.name, files }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}
