/**
 * Downloads registry — typed localStorage index of offline tracks.
 *
 * This is the metadata index (which tracks, when, how big). The actual audio
 * bytes live in the Cache Storage API (lib/offline/audioCache.ts), orchestrated
 * by features/downloads/downloadManager.ts. Track DTOs are stored here so the
 * library stays browsable while offline.
 */
import type { TrackDto } from '@aurial/shared';

const STORAGE_KEY = 'aurial:downloads';

export interface DownloadEntry {
  track: TrackDto;
  downloadedAt: string;
  /** Cached audio size in bytes (0 when unknown). */
  sizeBytes: number;
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

export function addDownload(track: TrackDto, sizeBytes = 0): void {
  if (isDownloaded(track.id)) return;
  write([{ track, downloadedAt: new Date().toISOString(), sizeBytes }, ...read()]);
}

/** Total bytes of all cached tracks. */
export function totalDownloadedBytes(): number {
  return read().reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
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
