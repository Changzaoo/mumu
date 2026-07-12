/**
 * Catalog feature — TanStack Query hooks over the Audius client
 * (`lib/catalog/audius.ts`). All catalog data (trending, search, playlists,
 * artist tracks) flows through here. Query keys are namespaced `['catalog', …]`.
 */
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ArtistDto, TrackDto } from '@aurial/shared';
import * as audius from '@/lib/catalog/audius';
import * as itunes from '@/lib/catalog/itunes';
import { appleSongToDto } from '@/lib/catalog/mapApple';
import type { CatalogPlaylist } from '@/lib/catalog/map';

const STALE = 5 * 60_000;
/** Apple charts change slowly — cache longer than the Audius trending feed. */
const APPLE_STALE = 10 * 60_000;

export function useTrending(genre?: string): UseQueryResult<TrackDto[]> {
  return useQuery({
    queryKey: ['catalog', 'trending', genre ?? null],
    staleTime: STALE,
    queryFn: () => audius.trending(genre ? { genre } : {}),
  });
}

export function useCatalogSearch(q: string): UseQueryResult<TrackDto[]> {
  const query = q.trim();
  return useQuery({
    queryKey: ['catalog', 'search', 'tracks', query],
    enabled: query.length > 0,
    staleTime: STALE,
    placeholderData: keepPreviousData,
    queryFn: () => audius.searchTracks(query),
  });
}

export function useCatalogSearchArtists(q: string): UseQueryResult<ArtistDto[]> {
  const query = q.trim();
  return useQuery({
    queryKey: ['catalog', 'search', 'artists', query],
    enabled: query.length > 0,
    staleTime: STALE,
    placeholderData: keepPreviousData,
    queryFn: () => audius.searchUsers(query),
  });
}

export function useTrendingPlaylists(): UseQueryResult<CatalogPlaylist[]> {
  return useQuery({
    queryKey: ['catalog', 'trending-playlists'],
    staleTime: STALE,
    queryFn: () => audius.trendingPlaylists(),
  });
}

export function useCatalogPlaylist(id: string): UseQueryResult<CatalogPlaylist | null> {
  return useQuery({
    queryKey: ['catalog', 'playlist-meta', id],
    enabled: id.length > 0,
    staleTime: STALE,
    queryFn: () => audius.playlist(id),
  });
}

export function usePlaylistTracks(id: string): UseQueryResult<TrackDto[]> {
  return useQuery({
    queryKey: ['catalog', 'playlist', id],
    enabled: id.length > 0,
    staleTime: STALE,
    queryFn: () => audius.playlistTracks(id),
  });
}

export function useArtistTracks(id: string): UseQueryResult<TrackDto[]> {
  return useQuery({
    queryKey: ['catalog', 'artist', id],
    enabled: id.length > 0,
    staleTime: STALE,
    queryFn: () => audius.userTracks(id),
  });
}

// ── Apple / iTunes: mainstream real-hits catalog (30s previews) ──────────────

/** Real "top songs" chart for a country (Home primary carousel). */
export function useTopSongs(cc = 'br'): UseQueryResult<TrackDto[]> {
  return useQuery({
    queryKey: ['catalog', 'apple', 'top', cc],
    staleTime: APPLE_STALE,
    queryFn: async () => (await itunes.topSongs(cc)).map(appleSongToDto),
  });
}

/** Real "top songs" for an Apple genre id (Home chips / Discover). */
export function useTopSongsByGenre(genreId: number, cc = 'br'): UseQueryResult<TrackDto[]> {
  return useQuery({
    queryKey: ['catalog', 'apple', 'top-genre', genreId, cc],
    // Apple genre ids are positive; a non-positive id is the "no genre" sentinel.
    enabled: genreId > 0,
    staleTime: APPLE_STALE,
    queryFn: async () => (await itunes.topSongsByGenre(genreId, cc)).map(appleSongToDto),
  });
}

/** Search the mainstream catalog by term (real songs, 30s previews). */
export function useAppleSearch(q: string, cc = 'br'): UseQueryResult<TrackDto[]> {
  const query = q.trim();
  return useQuery({
    queryKey: ['catalog', 'apple', 'search', query, cc],
    enabled: query.length > 0,
    staleTime: APPLE_STALE,
    placeholderData: keepPreviousData,
    queryFn: async () => (await itunes.searchSongs(query, cc)).map(appleSongToDto),
  });
}
