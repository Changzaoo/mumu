import { prisma } from '../../infra/db/prisma.js';
import { cursorWhere } from '../../core/http/pagination.js';
import {
  albumInclude,
  artistInclude,
  trackInclude,
  type AlbumRow,
  type ArtistRow,
  type ArtistRowWithExtras,
  type TrackRow,
} from '../shared/mappers.js';

export const artistsRepository = {
  list(cursor: string | undefined, limit: number): Promise<ArtistRowWithExtras[]> {
    return prisma.artist.findMany({
      where: cursorWhere(cursor),
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        bannerUrl: true,
        bio: true,
        verified: true,
        monthlyListeners: true,
        label: true,
        artistLabel: true,
        location: true,
        externalLinks: true,
        createdAt: true,
        genres: { include: { genre: { select: { name: true } } } },
        _count: { select: { followers: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    }) as Promise<ArtistRowWithExtras[]>;
  },

  findById(id: string): Promise<ArtistRowWithExtras | null> {
    return prisma.artist.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        bannerUrl: true,
        bio: true,
        verified: true,
        monthlyListeners: true,
        label: true,
        artistLabel: true,
        location: true,
        externalLinks: true,
        createdAt: true,
        updatedAt: true,
        genres: { include: { genre: { select: { name: true } } } },
        _count: { select: { followers: true } },
      },
    });
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
