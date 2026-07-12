/**
 * Download manager — orchestrates offline downloads of full audio files.
 *
 * Flow: fetch `track.downloadUrl` (single-file audio, auth header only for our
 * own API) with byte progress → store the blob in IndexedDB → index it in the
 * registry →
 * keep an in-memory object URL the AudioEngine plays from (via playerStore's
 * local source resolver). Playback prefers the local copy whenever present,
 * so downloaded tracks work fully offline.
 */
import type { TrackDto } from '@aurial/shared';
import { isFirstPartyUrl } from '@/lib/api';
import { getIdToken } from '@/lib/firebase';
import { prefetchLyrics } from '@/lib/lyrics/lyrics';
import {
  cacheSupported,
  deleteAudio,
  getAudioBlob,
  putAudio,
  requestPersistentStorage,
} from '@/lib/offline/audioCache';
import {
  addDownload,
  getDownloads,
  isDownloaded,
  removeDownload,
} from '@/features/downloads/registry';

export type DownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'error';

export interface DownloadState {
  status: DownloadStatus;
  /** 0..1 while downloading. */
  progress: number;
}

const inFlight = new Map<string, number>(); // trackId → progress 0..1
const failed = new Set<string>();
const blobUrls = new Map<string, string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeDownloadManager(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when offline downloads are usable (IndexedDB present). */
export function downloadsSupported(): boolean {
  return cacheSupported();
}

/** True when the track carries a downloadable single-file source. */
export function isDownloadable(track: TrackDto): boolean {
  return Boolean(track.downloadUrl) && cacheSupported();
}

export function downloadStateOf(trackId: string): DownloadState {
  const progress = inFlight.get(trackId);
  if (progress !== undefined) return { status: 'downloading', progress };
  if (failed.has(trackId)) return { status: 'error', progress: 0 };
  if (isDownloaded(trackId)) return { status: 'downloaded', progress: 1 };
  return { status: 'idle', progress: 0 };
}

/** Local object URL for a downloaded track, or null when not cached. */
export function localAudioUrl(trackId: string): string | null {
  return blobUrls.get(trackId) ?? null;
}

export async function downloadTrack(track: TrackDto): Promise<void> {
  if (!track.downloadUrl || !cacheSupported()) return;
  if (inFlight.has(track.id) || isDownloaded(track.id)) return;

  failed.delete(track.id);
  inFlight.set(track.id, 0);
  emit();

  try {
    void requestPersistentStorage();
    // Only send the Firebase token to our own API. Catalog tracks download
    // straight from the third-party Audius CDN — an Authorization header there
    // leaks the token and trips a CORS preflight the CDN rejects.
    const headers: Record<string, string> = {};
    if (isFirstPartyUrl(track.downloadUrl)) {
      const token = await getIdToken().catch(() => null);
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(track.downloadUrl, { headers });
    if (!res.ok || !res.body) throw new Error(`Falha no download (${res.status})`);

    const total = Number(res.headers.get('Content-Length') ?? 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.length;
      if (total > 0) {
        inFlight.set(track.id, Math.min(0.99, received / total));
        emit();
      }
    }

    const blob = new Blob(chunks as BlobPart[], {
      type: res.headers.get('Content-Type') ?? 'audio/mpeg',
    });
    await putAudio(track.id, blob);
    addDownload(track, blob.size);
    blobUrls.set(track.id, URL.createObjectURL(blob));
    prefetchLyrics(track); // cache synced lyrics for offline
    inFlight.delete(track.id);
    emit();
  } catch (err) {
    inFlight.delete(track.id);
    failed.add(track.id);
    emit();
    throw err;
  }
}

export async function removeDownloadedTrack(trackId: string): Promise<void> {
  await deleteAudio(trackId).catch(() => undefined);
  const url = blobUrls.get(trackId);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(trackId);
  }
  removeDownload(trackId);
  inFlight.delete(trackId);
  failed.delete(trackId);
  emit();
}

let hydrated = false;

/**
 * Rebuild the object-URL map from IndexedDB on boot so downloaded tracks
 * are immediately playable (including offline). Drops registry entries whose
 * audio the browser has evicted.
 */
export async function hydrateDownloads(): Promise<void> {
  if (hydrated || !cacheSupported()) return;
  hydrated = true;
  for (const entry of getDownloads()) {
    if (blobUrls.has(entry.track.id)) continue;
    const blob = await getAudioBlob(entry.track.id).catch(() => null);
    if (blob) blobUrls.set(entry.track.id, URL.createObjectURL(blob));
    else removeDownload(entry.track.id);
  }
  emit();
}
