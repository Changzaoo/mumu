import { prisma } from '../../infra/db/prisma.js';
import { cursorWhere } from '../../core/http/pagination.js';
import {
  albumInclude,
  artistInclude,
  trackInclude,
  type AlbumRow,
  type ArtistRow,
  type TrackRow,
} from '../shared/mappers.js';

export const artistsRepository = {
  list(cursor: string | undefined, limit: number): Promise<ArtistRow[]> {
    return prisma.artist.findMany({
      where: cursorWhere(cursor),
      include: artistInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  findById(id: string): Promise<ArtistRow | null> {
    return prisma.artist.findUnique({ where: { id }, include: artistInclude });
  },

  async isFollowedBy(userId: string, artistId: string): Promise<boolean> {
    const row = await prisma.artistFollow.findUnique({
      where: { userId_artistId: { userId, artistId } },
      select: { userId: true },
    });
    return row !== null;
  },

  topTracks(artistId: string, limit: number): Promise<TrackRow[]> {
    return prisma.track.findMany({
      where: { isPublic: true, artists: { some: { artistId } } },
      include: trackInclude,
      orderBy: [{ playsCount: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  },

  albums(artistId: string, cursor: string | undefined, limit: number): Promise<AlbumRow[]> {
    return prisma.album.findMany({
      where: { AND: [{ artists: { some: { artistId } } }, cursorWhere(cursor) ?? {}] },
      include: albumInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  async related(artistId: string, limit: number): Promise<ArtistRow[]> {
    const genres = await prisma.artistGenre.findMany({
      where: { artistId },
      select: { genreId: true },
    });
    const genreIds = genres.map((g) => g.genreId);
    if (genreIds.length === 0) {
      return prisma.artist.findMany({
        where: { id: { not: artistId } },
        include: artistInclude,
        orderBy: { monthlyListeners: 'desc' },
        take: limit,
      });
    }
    return prisma.artist.findMany({
      where: { id: { not: artistId }, genres: { some: { genreId: { in: genreIds } } } },
      include: artistInclude,
      orderBy: { monthlyListeners: 'desc' },
      take: limit,
    });
  },

  async follow(userId: string, artistId: string): Promise<void> {
    await prisma.artistFollow.upsert({
      where: { userId_artistId: { userId, artistId } },
      update: {},
      create: { userId, artistId },
    });
  },

  async unfollow(userId: string, artistId: string): Promise<void> {
    await prisma.artistFollow.deleteMany({ where: { userId, artistId } });
  },
};
