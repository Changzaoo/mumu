import type { AlbumDto, ArtistDto, TrackDto } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { eventBus } from '../../core/events/eventBus.js';
import { takePage, type CursorPage } from '../../core/http/pagination.js';
import { cache, cacheKeys, cacheTtl } from '../../infra/redis/cache.js';
import { toAlbumDto, toArtistDto, toTrackDto } from '../shared/mappers.js';
import { libraryRepository } from '../library/library.repository.js';
import { artistsRepository } from './artists.repository.js';

export const artistsService = {
  async list(cursor: string | undefined, limit: number): Promise<CursorPage<ArtistDto>> {
    const rows = await artistsRepository.list(cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    return { items: page.items.map(toArtistDto), meta: page.meta };
  },

  async getById(id: string, userId?: string): Promise<ArtistDto> {
    const key = cacheKeys.artist(id);
    let dto = await cache.getJson<ArtistDto>(key);
    if (!dto) {
      const row = await artistsRepository.findById(id);
      if (!row) throw new NotFoundError('Artist');
      dto = toArtistDto(row);
      await cache.setJson(key, dto, cacheTtl.entity);
    }
    // User-specific overlay is applied after caching (cached DTOs are flag-less).
    if (!userId) return dto;
    return { ...dto, isFollowing: await artistsRepository.isFollowedBy(userId, id) };
  },

  async topTracks(artistId: string, limit: number, userId?: string): Promise<TrackDto[]> {
    const artist = await artistsRepository.findById(artistId);
    if (!artist) throw new NotFoundError('Artist');
    const rows = await artistsRepository.topTracks(artistId, limit);
    const likedSet = userId
      ? await libraryRepository.likedTrackIdSet(
          userId,
          rows.map((r) => r.id),
        )
      : undefined;
    return rows.map((r) => toTrackDto(r, { likedSet }));
  },

  async albums(
    artistId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<AlbumDto>> {
    const rows = await artistsRepository.albums(artistId, cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    return { items: page.items.map(toAlbumDto), meta: page.meta };
  },

  async related(artistId: string, limit: number): Promise<ArtistDto[]> {
    const artist = await artistsRepository.findById(artistId);
    if (!artist) throw new NotFoundError('Artist');
    const rows = await artistsRepository.related(artistId, limit);
    return rows.map(toArtistDto);
  },

  async follow(userId: string, artistId: string): Promise<void> {
    const artist = await artistsRepository.findById(artistId);
    if (!artist) throw new NotFoundError('Artist');
    await artistsRepository.follow(userId, artistId);
    await cache.del(cacheKeys.artist(artistId));
    eventBus.emit('artist.followed', { userId, artistId, artistName: artist.name });
  },

  async unfollow(userId: string, artistId: string): Promise<void> {
    await artistsRepository.unfollow(userId, artistId);
    await cache.del(cacheKeys.artist(artistId));
  },
};
