/**
 * Downloads registry — typed localStorage wrapper for the PWA offline seam.
 *
 * This layer only tracks WHICH tracks the user marked for offline listening.
 * TODO(pwa): the actual audio caching (Cache Storage of HLS segments via the
 * service worker + background sync) is an integration-team concern; when it
 * lands, `addDownload` should also request the SW to prefetch
 * `/stream/:trackId/...` and `removeDownload` should evict the cache entries.
 */
import type { TrackDto } from '@aurial/shared';

const STORAGE_KEY = 'aurial:downloads';

export interface DownloadEntry {
  track: TrackDto;
  downloadedAt: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: DownloadEntry[] | null = null;

function read(): DownloadEntry[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as DownloadEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(entries: DownloadEntry[]): void {
  cache = entries;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded / private mode — registry stays in memory.
  }
  for (const notify of listeners) notify();
}

export function getDownloads(): DownloadEntry[] {
  return read();
}

export function isDownloaded(trackId: string): boolean {
  return read().some((entry) => entry.track.id === trackId);
}

export function addDownload(track: TrackDto): void {
  if (isDownloaded(track.id)) return;
  write([{ track, downloadedAt: new Date().toISOString() }, ...read()]);
}

export function removeDownload(trackId: string): void {
  write(read().filter((entry) => entry.track.id !== trackId));
}

export function clearDownloads(): void {
  write([]);
}

/** Subscribe to registry changes (useSyncExternalStore-friendly). */
export function subscribeDownloads(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
