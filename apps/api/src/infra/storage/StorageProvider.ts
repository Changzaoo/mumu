import type { Readable } from 'node:stream';

/**
 * Object storage abstraction. Keys are POSIX-style relative paths, e.g.
 * `uploads/raw/<id>`, `audio/<trackId>/master.m3u8`, `covers/<trackId>/300.webp`.
 */
export interface StorageProvider {
  put(key: string, data: Buffer | Readable, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Deletes every object under a prefix (HLS dirs, cover sets). */
  deletePrefix(prefix: string): Promise<void>;
  /** Public URL for CDN-servable assets (covers). Audio goes through /stream. */
  publicUrl(key: string): string;
  exists(key: string): Promise<boolean>;
}

/** Reads a whole object into memory — only for small files (playlists, covers). */
export async function readToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}
