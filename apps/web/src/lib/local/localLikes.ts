/**
 * Local likes — the user's "Curtidas", kept entirely on-device in localStorage.
 * Mirrors localPlaylists: an ordered id list (newest-first) plus a companion
 * Record<id, TrackDto> so the Curtidas page renders and plays without a backend.
 */
import type { TrackDto } from '@aurial/shared';
import { cloudCollection } from '@/lib/sync/cloudCollection';

const LIKES_KEY = 'aurial:local-likes'; // string[] of track ids, newest-first
const TRACKS_KEY = 'aurial:local-liked-tracks'; // Record<trackId, TrackDto>

interface LikeDoc {
  track: TrackDto;
  likedAt: string;
}

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

// Local-only appliers (used by the cloud sync — must not re-push).
function applyAdd(track: TrackDto): void {
  const ids = readIds();
  if (ids.includes(track.id)) return;
  writeTracks({ ...readTracks(), [track.id]: track });
  writeIds([track.id, ...ids]);
}

function applyRemove(id: string): void {
  const ids = readIds();
  if (!ids.includes(id)) return;
  writeIds(ids.filter((tid) => tid !== id));
  // The companion DTO is left in the map; it's tiny and harmless.
}

const cloud = cloudCollection<LikeDoc>({
  name: 'likes',
  localItems: () => {
    const map = readTracks();
    return readIds()
      .filter((id) => map[id])
      .map((id): [string, LikeDoc] => [
        id,
        { track: map[id] as TrackDto, likedAt: new Date().toISOString() },
      ]);
  },
  onRemoteUpsert: (_id, data) => applyAdd(data.track),
  onRemoteDelete: (id) => applyRemove(id),
});

/** Start/stop cross-device sync (called on auth change). */
export const setUser = cloud.setUser;

export function add(track: TrackDto): void {
  applyAdd(track);
  cloud.push(track.id, { track, likedAt: new Date().toISOString() });
}

export function remove(id: string): void {
  applyRemove(id);
  cloud.remove(id);
}

export function toggle(track: TrackDto, liked: boolean): void {
  if (liked) add(track);
  else remove(track.id);
}

export function count(): number {
  return readIds().length;
}

/** Drop any 30s-preview (iTunes) tracks saved before — not real playable songs. */
export function purgePreviews(): number {
  const map = readTracks();
  const bad = readIds().filter((id) => map[id]?.previewOnly);
  if (bad.length === 0) return 0;
  const badSet = new Set(bad);
  writeIds(readIds().filter((id) => !badSet.has(id)));
  const nextMap = { ...map };
  for (const id of bad) delete nextMap[id];
  writeTracks(nextMap);
  for (const id of bad) cloud.remove(id);
  emit();
  return bad.length;
}
