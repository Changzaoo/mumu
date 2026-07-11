/**
 * Offline audio cache — persists downloaded tracks in the Cache Storage API so
 * they play without a network connection.
 *
 * Cache Storage requires a secure context (HTTPS or localhost). Over plain
 * http:// on a LAN IP it is unavailable — callers must check `cacheSupported()`
 * and degrade gracefully (the download UI hides itself).
 *
 * Audio is stored as a reconstructed same-origin Response keyed by a synthetic
 * path, so cross-origin/opaque responses never leak into the cache.
 */
const CACHE_NAME = 'aurial-audio-v1';

const keyFor = (trackId: string): string => `/__offline_audio__/${encodeURIComponent(trackId)}`;

export function cacheSupported(): boolean {
  return (
    typeof caches !== 'undefined' &&
    typeof window !== 'undefined' &&
    window.isSecureContext === true
  );
}

export async function putAudio(trackId: string, blob: Blob): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    keyFor(trackId),
    new Response(blob, {
      headers: {
        'Content-Type': blob.type || 'audio/mpeg',
        'Content-Length': String(blob.size),
      },
    }),
  );
}

export async function getAudioBlob(trackId: string): Promise<Blob | null> {
  if (!cacheSupported()) return null;
  const cache = await caches.open(CACHE_NAME);
  const res = await cache.match(keyFor(trackId));
  return res ? await res.blob() : null;
}

export async function hasAudio(trackId: string): Promise<boolean> {
  if (!cacheSupported()) return false;
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(keyFor(trackId))) !== undefined;
}

export async function deleteAudio(trackId: string): Promise<void> {
  if (!cacheSupported()) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(keyFor(trackId));
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

/** Ask the browser to keep this origin's storage from being evicted under pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
