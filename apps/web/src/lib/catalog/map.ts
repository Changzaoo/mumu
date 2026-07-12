/**
 * Audius → Aurial domain mappers.
 *
 * The Audius public API returns rich track/user/playlist objects; the rest of
 * the app speaks `TrackDto` / `ArtistDto`. These pure functions bridge the two.
 * Catalog track ids are namespaced (`audius:<id>`) so they never collide with
 * local (`local:<uuid>`) or backend track ids, and both `streamUrl` and
 * `downloadUrl` point at the Audius stream endpoint — making every catalog
 * track directly playable, downloadable (→ offline) and therefore shareable.
 */
import type { ArtistDto, TrackDto } from '@aurial/shared';
import { audiusHost } from '@/lib/catalog/audius';

/** Audius artwork/profile picture bag (sizes are optional per node). */
export interface AudiusArtwork {
  '150x150'?: string;
  '480x480'?: string;
  '1000x1000'?: string;
}

export interface AudiusUser {
  id: string;
  name: string;
  handle: string;
  profile_picture?: AudiusArtwork | null;
  cover_photo?: AudiusArtwork | null;
  bio?: string | null;
  is_verified?: boolean;
  follower_count?: number;
  track_count?: number;
}

export interface AudiusTrack {
  id: string;
  title: string;
  user: AudiusUser;
  /** Seconds. */
  duration: number;
  artwork?: AudiusArtwork | null;
  genre?: string;
  mood?: string;
  play_count?: number;
  repost_count?: number;
  favorite_count?: number;
}

export interface AudiusPlaylist {
  id: string;
  playlist_name: string;
  description?: string | null;
  artwork?: AudiusArtwork | null;
  user: AudiusUser;
  total_track_count?: number;
}

/** Lightweight catalog playlist (backend `PlaylistDto` is server-only). */
export interface CatalogPlaylist {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  userName: string;
  trackCount: number;
}

/** Directly-playable Audius stream URL (302 → mp3, CORS-enabled). */
export function streamUrlFor(id: string): string {
  return `${audiusHost()}/v1/tracks/${id}/stream?app_name=Aurial`;
}

export function audiusTrackToDto(t: AudiusTrack): TrackDto {
  const stream = streamUrlFor(t.id);
  return {
    id: `audius:${t.id}`,
    title: t.title,
    durationMs: t.duration * 1000,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: t.play_count ?? 0,
    coverUrl: t.artwork?.['480x480'] ?? null,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: [
      {
        id: `audius-user:${t.user.id}`,
        name: t.user.name,
        slug: t.user.handle,
        imageUrl: t.user.profile_picture?.['150x150'] ?? null,
      },
    ],
    streamUrl: stream,
    // Catalog tracks are downloadable → cached offline → re-shareable over P2P.
    downloadUrl: stream,
    genre: t.genre ?? null,
    uploadedByUserId: null,
  };
}

export function audiusUserToArtist(u: AudiusUser): ArtistDto {
  return {
    id: `audius-user:${u.id}`,
    name: u.name,
    slug: u.handle,
    imageUrl: u.profile_picture?.['480x480'] ?? u.profile_picture?.['150x150'] ?? null,
    bannerUrl: u.cover_photo?.['1000x1000'] ?? null,
    bio: u.bio ?? null,
    verified: u.is_verified ?? false,
    monthlyListeners: 0,
    followersCount: u.follower_count ?? 0,
    genres: [],
  };
}

export function audiusPlaylistToCatalog(p: AudiusPlaylist): CatalogPlaylist {
  return {
    id: p.id,
    title: p.playlist_name,
    description: p.description ?? null,
    coverUrl: p.artwork?.['480x480'] ?? null,
    userName: p.user?.name ?? '',
    trackCount: p.total_track_count ?? 0,
  };
}
