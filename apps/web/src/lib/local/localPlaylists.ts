/**
 * Local playlists — the user's OWN playlists, kept entirely on-device in
 * localStorage. Distinct from server playlists (`/library`): these exist so a
 * user can recreate a list (e.g. their Spotify "Músicas Curtidas") from a
 * pasted track list, cover-rich and instantly playable as 30s previews.
 *
 *   registry → `aurial:local-playlists`         (LocalPlaylist[])
 *   tracks   → `aurial:local-playlist-tracks`   (Record<trackId, TrackDto>)
 *
 * We stash the TrackDto itself in a companion map so a playlist entry still
 * renders (cover + title) even when it's an iTunes preview track that lives in
 * no audio library. When the user later imports the matching file, the local
 * track can be added and it upgrades to full offline playback.
 */
import type { PlaylistDto, PlaylistWithTracksDto, TrackDto } from '@aurial/shared';
import { cloudCollection } from '@/lib/sync/cloudCollection';

const PLAYLISTS_KEY = 'aurial:local-playlists';
const TRACKS_KEY = 'aurial:local-playlist-tracks';

/** Firestore doc shape: a self-contained playlist (its tracks embedded). */
interface PlaylistDocData {
  title: string;
  createdAt: string;
  tracks: TrackDto[];
}

export interface LocalPlaylist {
  id: string;
  title: string;
  trackIds: string[];
  createdAt: string;
}

// ── in-memory cache + subscribers ───────────────────────────────
let playlistsCache: LocalPlaylist[] | null = null;
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

// ── storage helpers ─────────────────────────────────────────────
function readPlaylists(): LocalPlaylist[] {
  if (playlistsCache) return playlistsCache;
  try {
    const raw = window.localStorage.getItem(PLAYLISTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    playlistsCache = Array.isArray(parsed) ? (parsed as LocalPlaylist[]) : [];
  } catch {
    playlistsCache = [];
  }
  return playlistsCache;
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

function writePlaylists(next: LocalPlaylist[]): void {
  playlistsCache = next;
  try {
    window.localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — stays in memory for the session.
  }
  emit();
}

function writeTracks(next: Record<string, TrackDto>): void {
  tracksCache = next;
  try {
    window.localStorage.setItem(TRACKS_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — stays in memory for the session.
  }
}

/** Merge tracks into the companion map (id → TrackDto), keyed by track id. */
function rememberTracks(tracks: TrackDto[]): void {
  if (tracks.length === 0) return;
  const map = { ...readTracks() };
  for (const track of tracks) map[track.id] = track;
  writeTracks(map);
}

// ── public API ──────────────────────────────────────────────────
export function list(): LocalPlaylist[] {
  return readPlaylists();
}

export function get(id: string): LocalPlaylist | null {
  return readPlaylists().find((p) => p.id === id) ?? null;
}

/** Create a playlist; optionally seed it with tracks (stored in the map). */
export function create(title: string, tracks: TrackDto[] = []): LocalPlaylist {
  rememberTracks(tracks);
  const playlist: LocalPlaylist = {
    id: `local-list:${crypto.randomUUID()}`,
    title: title.trim() || 'Nova lista',
    trackIds: tracks.map((t) => t.id),
    createdAt: new Date().toISOString(),
  };
  writePlaylists([playlist, ...readPlaylists()]);
  pushPlaylist(playlist.id);
  return playlist;
}

/** Append tracks to a playlist (dedupes ids, persists the TrackDtos). */
export function addTracks(id: string, tracks: TrackDto[]): void {
  rememberTracks(tracks);
  writePlaylists(
    readPlaylists().map((p) => {
      if (p.id !== id) return p;
      const seen = new Set(p.trackIds);
      const added = tracks.map((t) => t.id).filter((tid) => !seen.has(tid));
      return { ...p, trackIds: [...p.trackIds, ...added] };
    }),
  );
  pushPlaylist(id);
}

export function remove(id: string): void {
  writePlaylists(readPlaylists().filter((p) => p.id !== id));
  cloud.remove(id);
  // Companion track entries are intentionally left; they're tiny and may be
  // referenced by other lists. They fall out of use harmlessly.
}

/** Remove a single track from a playlist (by track id). */
export function removeTrack(id: string, trackId: string): void {
  writePlaylists(
    readPlaylists().map((p) =>
      p.id === id ? { ...p, trackIds: p.trackIds.filter((tid) => tid !== trackId) } : p,
    ),
  );
  pushPlaylist(id);
}

// ── cross-device sync (Firestore) ───────────────────────────────
const cloud = cloudCollection<PlaylistDocData>({
  name: 'playlists',
  localItems: () =>
    readPlaylists().map((p): [string, PlaylistDocData] => [
      p.id,
      { title: p.title, createdAt: p.createdAt, tracks: resolveTracks(p.id) },
    ]),
  onRemoteUpsert: (id, data) => applyRemoteUpsert(id, data),
  onRemoteDelete: (id) => applyRemoteDelete(id),
});

/** Start/stop cross-device sync (called on auth change). */
export const setUser = cloud.setUser;

function pushPlaylist(id: string): void {
  const playlist = get(id);
  if (playlist) {
    cloud.push(id, {
      title: playlist.title,
      createdAt: playlist.createdAt,
      tracks: resolveTracks(id),
    });
  }
}

/** Apply a remote playlist (add or update) to local storage — no re-push. */
function applyRemoteUpsert(id: string, data: PlaylistDocData): void {
  rememberTracks(data.tracks);
  const playlist: LocalPlaylist = {
    id,
    title: data.title,
    trackIds: data.tracks.map((t) => t.id),
    createdAt: data.createdAt,
  };
  const existing = readPlaylists();
  writePlaylists(
    existing.some((p) => p.id === id)
      ? existing.map((p) => (p.id === id ? playlist : p))
      : [playlist, ...existing],
  );
}

function applyRemoteDelete(id: string): void {
  writePlaylists(readPlaylists().filter((p) => p.id !== id));
}

/** Resolve a playlist's stored TrackDtos, in order (skips any missing). */
export function resolveTracks(id: string): TrackDto[] {
  const playlist = get(id);
  if (!playlist) return [];
  const map = readTracks();
  return playlist.trackIds.map((tid) => map[tid]).filter((t): t is TrackDto => t !== undefined);
}

// ── adapters to the central PlaylistDto shapes ──────────────────
// So local playlists render through the same Sidebar / LibraryPage / PlaylistPage
// components as server playlists. The `local-list:` id prefix is the discriminator.

/** True when an id belongs to a locally-stored playlist. */
export function isLocalPlaylistId(id: string): boolean {
  return id.startsWith('local-list:');
}

/** A stand-in "owner" so PlaylistDto is satisfied; id `local` never matches a
 *  real Firebase uid, which keeps server-only edit/delete controls hidden. */
const LOCAL_OWNER = { id: 'local', handle: 'voce', displayName: 'Você', avatarUrl: null } as const;

/** Map a LocalPlaylist to the central PlaylistDto (cover/duration derived from tracks). */
export function toPlaylistDto(playlist: LocalPlaylist): PlaylistDto {
  const tracks = resolveTracks(playlist.id);
  return {
    id: playlist.id,
    title: playlist.title,
    description: null,
    coverUrl: tracks.find((t) => t.coverUrl)?.coverUrl ?? null,
    dominantColor: null,
    isPublic: false,
    isCollaborative: false,
    trackCount: tracks.length,
    durationMs: tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0),
    followersCount: 0,
    owner: LOCAL_OWNER,
    createdAt: playlist.createdAt,
    updatedAt: playlist.createdAt,
  };
}

/** Map a LocalPlaylist to the detail (with-tracks) DTO the PlaylistPage renders. */
export function toPlaylistWithTracksDto(playlist: LocalPlaylist): PlaylistWithTracksDto {
  const tracks = resolveTracks(playlist.id);
  return {
    ...toPlaylistDto(playlist),
    tracks: tracks.map((track, position) => ({
      entryId: track.id,
      position,
      addedAt: playlist.createdAt,
      addedBy: null,
      track,
    })),
  };
}

/** All local playlists as PlaylistDto (newest first). */
export function listAsDto(): PlaylistDto[] {
  return readPlaylists().map(toPlaylistDto);
}
