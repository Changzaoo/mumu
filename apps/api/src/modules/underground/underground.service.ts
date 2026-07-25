import type { ArtistDto, TrackDto } from '@aurial/shared';
import { cache, cacheKeys, cacheTtl } from '../../infra/redis/cache.js';
import { undergroundRepository } from './underground.repository.js';
import { toArtistDto, toTrackDto } from '../shared/mappers.js';
import type { TrackRow, ArtistRowWithExtras } from '../shared/mappers.js';

export const undergroundService = {
  /**
   * List underground artists with caching
   */
  async listArtists(
    cursor: string | undefined,
    limit: number,
    opts: { minListeners?: number; maxListeners?: number; label?: string } = {},
  ): Promise<{ items: ArtistDto[]; nextCursor: string | null }> {
    const cacheKey = cacheKeys.undergroundArtists(cursor, limit, opts);
    const cached = await cache.getJson<{ items: ArtistDto[]; nextCursor: string | null }>(cacheKey);
    if (cached) return cached;

    const { items, nextCursor } = await undergroundRepository.listUndergroundArtists(
      cursor,
      limit,
      opts,
    );
    const result = { items: items.map(toArtistDto), nextCursor };
    await cache.setJson(cacheKey, result, cacheTtl.list);
    return result;
  },

  /**
   * Search underground artists
   */
  async searchArtists(
    query: string,
    limit: number,
    opts: { label?: string; location?: string } = {},
  ): Promise<ArtistDto[]> {
    const rows = await undergroundRepository.searchUndergroundArtists(query, limit, opts);
    return rows.map(toArtistDto);
  },

  /**
   * Get underground tracks with caching
   */
  async getTracks(
    cursor: string | undefined,
    limit: number,
    opts: { label?: string; genre?: string } = {},
  ): Promise<{ items: TrackDto[]; nextCursor: string | null }> {
    const cacheKey = `underground:tracks:${cursor}:${limit}:${opts.label}:${opts.genre}`;
    const cached = await cache.getJson<{ items: TrackDto[]; nextCursor: string | null }>(cacheKey);
    if (cached) return cached;

    const { items, nextCursor } = await undergroundRepository.getUndergroundTracks(
      cursor,
      limit,
      opts,
    );
    const result = { items: items.map((item) => toTrackDto(item)), nextCursor };
    await cache.setJson(cacheKey, result, cacheTtl.list);
    return result;
  },

  /**
   * Get genres from underground artists
   */
  async getGenres(label: string = 'underground'): Promise<string[]> {
    const cacheKey = cacheKeys.undergroundGenres(label);
    const cached = await cache.getJson<string[]>(cacheKey);
    if (cached) return cached;

    const genres = await undergroundRepository.getUndergroundGenres(label);
    await cache.setJson(cacheKey, genres, cacheTtl.short);
    return genres;
  },

  /**
   * Get locations from underground artists
   */
  async getLocations(label: string = 'underground'): Promise<string[]> {
    const cacheKey = cacheKeys.undergroundLocations(label);
    const cached = await cache.getJson<string[]>(cacheKey);
    if (cached) return cached;

    const locations = await undergroundRepository.getUndergroundLocations(label);
    await cache.setJson(cacheKey, locations, cacheTtl.short);
    return locations;
  },

  /**
   * Get trending underground tracks
   */
  async getTrendingTracks(
    limit: number,
    label: string = 'underground',
    days: number = 7,
  ): Promise<TrackDto[]> {
    const cacheKey = cacheKeys.undergroundTrending(limit, label, days);
    const cached = await cache.getJson<TrackDto[]>(cacheKey);
    if (cached) return cached;

    const tracks = await undergroundRepository.getTrendingUndergroundTracks(limit, label, days);
    const result = tracks.map((track) => toTrackDto(track));
    await cache.setJson(cacheKey, result, cacheTtl.short);
    return result;
  },
};
