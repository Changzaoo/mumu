import { prisma } from '../../infra/db/prisma.js';
import { cursorWhere } from '../../core/http/pagination.js';
import { albumInclude, trackInclude, type AlbumRow, type TrackRow } from '../shared/mappers.js';

export const albumsRepository = {
  list(cursor: string | undefined, limit: number): Promise<AlbumRow[]> {
    return prisma.album.findMany({
      where: cursorWhere(cursor),
      include: albumInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  findById(id: string): Promise<AlbumRow | null> {
    return prisma.album.findUnique({ where: { id }, include: albumInclude });
  },

  tracksOf(albumId: string): Promise<TrackRow[]> {
    return prisma.track.findMany({
      // Só o público: o resultado é cacheado para todos (albums.service getById).
      where: { albumId, isPublic: true },
      include: trackInclude,
      orderBy: [{ discNumber: 'asc' }, { trackNumber: 'asc' }, { title: 'asc' }],
      take: 200,
    });
  },

  newReleases(limit: number): Promise<AlbumRow[]> {
    return prisma.album.findMany({
      where: { releaseDate: { not: null } },
      include: albumInclude,
      orderBy: { releaseDate: 'desc' },
      take: limit,
    });
  },
};
