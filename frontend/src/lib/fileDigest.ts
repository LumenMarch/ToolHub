import { createMD5, createSHA256 } from 'hash-wasm';

const HASH_CHUNK_SIZE = 4 * 1024 * 1024;
const HASH_READ_CONCURRENCY = 2;

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

  const hashBatch = async (offset: number): Promise<void> => {
    if (offset >= file.size) {
      return;
    }
    if (options.signal?.aborted) {
      throw new DOMException('摘要计算已取消', 'AbortError');
    }

    const remainingChunks = Math.ceil((file.size - offset) / HASH_CHUNK_SIZE);
    const batchSize = Math.min(HASH_READ_CONCURRENCY, remainingChunks);
    const chunks = await Promise.all(
      Array.from({ length: batchSize }, async (_, index) => {
        const start = offset + index * HASH_CHUNK_SIZE;
        const end = Math.min(start + HASH_CHUNK_SIZE, file.size);
        const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer());
        return { chunk, end };
      }),
    );

    if (options.signal?.aborted) {
      throw new DOMException('摘要计算已取消', 'AbortError');
    }

    for (const { chunk, end } of chunks) {
      md5.update(chunk);
      sha256.update(chunk);
      options.onProgress?.(end, file.size);
    }

    return hashBatch(offset + batchSize * HASH_CHUNK_SIZE);
  };

  await hashBatch(0);

  return {
    md5: md5.digest('hex'),
    sha256: sha256.digest('hex'),
    size: file.size,
  };
}
