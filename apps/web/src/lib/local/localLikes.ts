/**
 * Local likes — the user's "Curtidas", kept entirely on-device in localStorage.
 * Mirrors localPlaylists: an ordered id list (newest-first) plus a companion
 * Record<id, TrackDto> so the Curtidas page renders and plays without a backend.
 */
import type { TrackDto } from '@aurial/shared';

const LIKES_KEY = 'aurial:local-likes'; // string[] of track ids, newest-first
const TRACKS_KEY = 'aurial:local-liked-tracks'; // Record<trackId, TrackDto>

let idsCache: string[] | null = null;
let tracksCache: Record<string, TrackDto> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readIds(): string[] {
  if (idsCache) return idsCache;
  try {
    const raw = window.localStorage.getItem(LIKES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    idsCache = Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    idsCache = [];
  }
  return idsCache;
}

function readTracks(): Record<string, TrackDto> {
  if (tracksCache) return tracksCache;
  try {
    const raw = window.localStorage.getItem(TRACKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    tracksCache = parsed && typeof parsed === 'object' ? (parsed as Record<string, TrackDto>) : {};
  } catch {
    tracksCache = {};
  }
  return tracksCache;
}

function writeIds(next: string[]): void {
  idsCache = next;
  try {
    window.localStorage.setItem(LIKES_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — stays in memory */
  }
  emit();
}

function writeTracks(next: Record<string, TrackDto>): void {
  tracksCache = next;
  try {
    window.localStorage.setItem(TRACKS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — stays in memory */
  }
}

export function has(id: string): boolean {
  return readIds().includes(id);
}

/** Liked tracks, newest-first (skips any whose DTO was lost). */
export function list(): TrackDto[] {
  const map = readTracks();
  return readIds()
    .map((id) => map[id])
    .filter((t): t is TrackDto => t !== undefined);
}

export function add(track: TrackDto): void {
  const ids = readIds();
  if (ids.includes(track.id)) return;
  writeTracks({ ...readTracks(), [track.id]: track });
  writeIds([track.id, ...ids]);
}

export function remove(id: string): void {
  const ids = readIds();
  if (!ids.includes(id)) return;
  writeIds(ids.filter((tid) => tid !== id));
  // The companion DTO is left in the map; it's tiny and harmless.
}

export function toggle(track: TrackDto, liked: boolean): void {
  if (liked) add(track);
  else remove(track.id);
}

export function count(): number {
  return readIds().length;
}
