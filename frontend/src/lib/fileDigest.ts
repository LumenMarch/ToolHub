import { createMD5, createSHA256 } from 'hash-wasm';

const HASH_CHUNK_SIZE = 4 * 1024 * 1024;

export interface FileDigest {
  md5: string;
  sha256: string;
  size: number;
}

export async function calculateFileDigest(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (bytesHashed: number, bytesTotal: number) => void;
  } = {},
): Promise<FileDigest> {
  const [md5, sha256] = await Promise.all([createMD5(), createSHA256()]);
  md5.init();
  sha256.init();

  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_SIZE) {
    if (options.signal?.aborted) {
      throw new DOMException('摘要计算已取消', 'AbortError');
    }
    const end = Math.min(offset + HASH_CHUNK_SIZE, file.size);
    const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    md5.update(chunk);
    sha256.update(chunk);
    options.onProgress?.(end, file.size);
  }

  if (options.signal?.aborted) {
    throw new DOMException('摘要计算已取消', 'AbortError');
  }
  return {
    md5: md5.digest('hex'),
    sha256: sha256.digest('hex'),
    size: file.size,
  };
}
