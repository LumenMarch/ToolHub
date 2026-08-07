/**
 * 拖放目录遍历工具:把 DataTransfer 条目递归展开为扁平文件列表。
 * FileDropZone 专用,独立成模块便于测试与保持组件文件 fast-refresh 纯净。
 */

/**
 * 递归读取目录条目:readEntries 每次只返回一部分条目,
 * 必须循环调用直到返回空数组才算读完(Chromium 行为)。
 */
export const readAllDirectoryEntries = (
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> => {
  const { promise, resolve, reject } =
    Promise.withResolvers<FileSystemEntry[]>();
  const entries: FileSystemEntry[] = [];
  const readBatch = () => {
    reader.readEntries((batch) => {
      if (batch.length === 0) {
        resolve(entries);
        return;
      }
      entries.push(...batch);
      readBatch();
    }, reject);
  };
  readBatch();
  return promise;
};

/**
 * 从拖放条目递归收集文件:文件条目直接取,目录条目深度遍历(含子目录)。
 * 出现目录时结果按 webkitRelativePath/name 排序,保证确定性顺序;
 * 纯文件拖放保持条目顺序不变,对既有调用方透明。
 */
export const collectDroppedFiles = async (
  entries: FileSystemEntry[],
): Promise<File[]> => {
  const collected: File[] = [];
  let sawDirectory = false;

  const readEntry = async (entry: FileSystemEntry) => {
    if (entry.isFile) {
      const { promise, resolve, reject } = Promise.withResolvers<File>();
      (entry as FileSystemFileEntry).file(resolve, reject);
      collected.push(await promise);
    } else if (entry.isDirectory) {
      sawDirectory = true;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children = await readAllDirectoryEntries(reader);
      // 子条目递归相互独立,并行展开;目录场景由末尾 sort 兜底顺序。
      await Promise.all(children.map((child) => readEntry(child)));
    }
  };

  for (const entry of entries) {
    await readEntry(entry);
  }

  if (sawDirectory) {
    collected.sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(
        b.webkitRelativePath || b.name,
        undefined,
        { numeric: true, sensitivity: 'base' },
      ),
    );
  }
  return collected;
};
