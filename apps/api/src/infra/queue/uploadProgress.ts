import { redis } from '../redis/redis.js';
import { cacheKeys } from '../redis/cache.js';

const PROGRESS_TTL_SECONDS = 24 * 3600;

/** Worker → API progress channel for the upload status endpoint. */
export async function setUploadProgress(uploadId: string, progress: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  await redis
    .set(cacheKeys.uploadProgress(uploadId), String(clamped), 'EX', PROGRESS_TTL_SECONDS)
    .catch(() => undefined);
}

export async function getUploadProgress(uploadId: string): Promise<number | null> {
  try {
    const raw = await redis.get(cacheKeys.uploadProgress(uploadId));
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
