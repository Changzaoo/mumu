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

// ── Apple / iTunes: artist discographies (albums) ───────────────────────────

/** Every album by the given library artists (iTunes), deduped, newest first. */
export function useLibraryArtistAlbums(artistNames: string[]): UseQueryResult<itunes.AppleAlbum[]> {
  const key = [...artistNames].sort().join('|');
  return useQuery({
    queryKey: ['library', 'artist-albums', key],
    enabled: artistNames.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const all: itunes.AppleAlbum[] = [];
      const seen = new Set<number>();
      for (const name of artistNames.slice(0, 20)) {
        const id = await itunes.searchArtistId(name).catch(() => null);
        if (!id) continue;
        for (const album of await itunes.artistAlbums(id).catch(() => [])) {
          if (seen.has(album.collectionId)) continue;
          seen.add(album.collectionId);
          all.push(album);
        }
      }
      return all.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
    },
  });
}

/** The tracks of an iTunes album (collectionId), with REAL durations. */
export function useAppleAlbumTracks(collectionId: number): UseQueryResult<TrackDto[]> {
  return useQuery({
    queryKey: ['catalog', 'apple', 'album', collectionId],
    enabled: collectionId > 0,
    staleTime: 30 * 60_000,
    queryFn: async () =>
      (await itunes.albumTracks(collectionId)).map((s): TrackDto => ({
        ...appleSongToDto(s),
        durationMs: s.trackTimeMillis || 30000,
      })),
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
