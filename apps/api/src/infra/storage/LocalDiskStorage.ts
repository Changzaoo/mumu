import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../../config/index.js';
import { NotFoundError, ValidationError } from '../../core/errors/index.js';
import type { StorageProvider } from './StorageProvider.js';

/** Dev storage on the local disk. Files are served statically under /media. */
export class LocalDiskStorage implements StorageProvider {
  readonly baseDir: string;

  constructor(baseDir = env.STORAGE_LOCAL_PATH) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolve(key: string): string {
    const full = path.resolve(this.baseDir, key);
    // Prevent path traversal via crafted keys.
    if (!full.startsWith(this.baseDir + path.sep) && full !== this.baseDir) {
      throw new ValidationError('Invalid storage key');
    }
    return full;
  }

  async put(key: string, data: Buffer | Readable, _contentType: string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    if (Buffer.isBuffer(data)) {
      await writeFile(full, data);
    } else {
      await pipeline(data, createWriteStream(full));
    }
  }

  async getStream(key: string): Promise<Readable> {
    const full = this.resolve(key);
    try {
      await access(full);
    } catch {
      throw new NotFoundError(`Object ${key}`);
    }
    return createReadStream(full);
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.resolve(key))).size;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      // idempotent delete
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolve(prefix), { recursive: true, force: true });
  }

  publicUrl(key: string): string {
    return `${env.API_BASE_URL}/media/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
