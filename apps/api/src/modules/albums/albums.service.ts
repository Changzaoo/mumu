import type { AlbumDto, AlbumWithTracksDto } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { takePage, type CursorPage } from '../../core/http/pagination.js';
import { cache, cacheKeys, cacheTtl } from '../../infra/redis/cache.js';
import { applyLikedFlags, toAlbumDto, toAlbumWithTracksDto } from '../shared/mappers.js';
import { libraryRepository } from '../library/library.repository.js';
import { albumsRepository } from './albums.repository.js';

export const albumsService = {
  async list(cursor: string | undefined, limit: number): Promise<CursorPage<AlbumDto>> {
    const rows = await albumsRepository.list(cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    return { items: page.items.map(toAlbumDto), meta: page.meta };
  },

  /** Cached without personal flags; isLiked is overlaid per-request. */
  async getById(id: string, userId?: string): Promise<AlbumWithTracksDto> {
    const key = cacheKeys.album(id);
    let dto = await cache.getJson<AlbumWithTracksDto>(key);
    if (!dto) {
      const row = await albumsRepository.findById(id);
      if (!row) throw new NotFoundError('Album');
      const tracks = await albumsRepository.tracksOf(id);
      dto = toAlbumWithTracksDto(row, tracks);
      await cache.setJson(key, dto, cacheTtl.entity);
    }
    if (userId) {
      const likedSet = await libraryRepository.likedTrackIdSet(
        userId,
        dto.tracks.map((t) => t.id),
      );
      return { ...dto, tracks: applyLikedFlags(dto.tracks, likedSet) };
    }
    return dto;
  },

  async newReleases(limit: number): Promise<AlbumDto[]> {
    const rows = await albumsRepository.newReleases(limit);
    return rows.map(toAlbumDto);
  },
};
