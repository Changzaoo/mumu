import type { ArtistDto, TrackDto } from '@aurial/shared';
import {
  encodeNumericCursor,
  takePage,
  takePageWith,
  type CursorPage,
} from '../../core/http/pagination.js';
import { cache, cacheKeys, cacheTtl } from '../../infra/redis/cache.js';
import { toArtistDto, toTrackDto } from '../shared/mappers.js';
import { DEFAULT_CATALOG_TAG, undergroundRepository } from './underground.repository.js';

export const undergroundService = {
  async listArtists(
    cursor: string | undefined,
    limit: number,
    opts: { minListeners?: number; maxListeners?: number; catalogTag?: string } = {},
  ): Promise<CursorPage<ArtistDto>> {
    const cacheKey = cacheKeys.undergroundArtists(cursor, limit, opts);
    const cached = await cache.getJson<CursorPage<ArtistDto>>(cacheKey);
    if (cached) return cached;

    const rows = await undergroundRepository.listArtists(cursor, limit, opts);
    const page = takePageWith(rows, limit, (r) => encodeNumericCursor(r.monthlyListeners, r.id));
    const result = { items: page.items.map(toArtistDto), meta: page.meta };
    await cache.setJson(cacheKey, result, cacheTtl.list);
    return result;
  },

  /** Uncached: free-text search has an unbounded key space. */
  async searchArtists(
    query: string,
    limit: number,
    opts: { catalogTag?: string; location?: string } = {},
  ): Promise<ArtistDto[]> {
    const rows = await undergroundRepository.searchArtists(query, limit, opts);
    return rows.map(toArtistDto);
  },

  async listTracks(
    cursor: string | undefined,
    limit: number,
    opts: { catalogTag?: string; genre?: string } = {},
  ): Promise<CursorPage<TrackDto>> {
    const cacheKey = cacheKeys.undergroundTracks(cursor, limit, opts);
    const cached = await cache.getJson<CursorPage<TrackDto>>(cacheKey);
    if (cached) return cached;

    const rows = await undergroundRepository.listTracks(cursor, limit, opts);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    const result = { items: page.items.map((row) => toTrackDto(row)), meta: page.meta };
    await cache.setJson(cacheKey, result, cacheTtl.list);
    return result;
  },

  async listGenres(catalogTag: string = DEFAULT_CATALOG_TAG): Promise<string[]> {
    const cacheKey = cacheKeys.undergroundGenres(catalogTag);
    const cached = await cache.getJson<string[]>(cacheKey);
    if (cached) return cached;

    const genres = await undergroundRepository.listGenres(catalogTag);
    await cache.setJson(cacheKey, genres, cacheTtl.short);
    return genres;
  },

  async listLocations(catalogTag: string = DEFAULT_CATALOG_TAG): Promise<string[]> {
    const cacheKey = cacheKeys.undergroundLocations(catalogTag);
    const cached = await cache.getJson<string[]>(cacheKey);
    if (cached) return cached;

    const locations = await undergroundRepository.listLocations(catalogTag);
    await cache.setJson(cacheKey, locations, cacheTtl.short);
    return locations;
  },

  async listTrendingTracks(
    limit: number,
    catalogTag: string = DEFAULT_CATALOG_TAG,
    days: number = 7,
  ): Promise<TrackDto[]> {
    const cacheKey = cacheKeys.undergroundTrending(limit, catalogTag, days);
    const cached = await cache.getJson<TrackDto[]>(cacheKey);
    if (cached) return cached;

    const rows = await undergroundRepository.listTrendingTracks(limit, catalogTag, days);
    const result = rows.map((row) => toTrackDto(row));
    await cache.setJson(cacheKey, result, cacheTtl.short);
    return result;
  },
};
