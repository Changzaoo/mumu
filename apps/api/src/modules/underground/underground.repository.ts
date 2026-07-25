import { prisma } from '../../infra/db/prisma.js';
import { artistInclude } from '../shared/mappers.js';
import type { Prisma } from '@prisma/client';

export const undergroundRepository = {
  /**
   * Get underground artists (artists with label = 'underground' or similar labels)
   * Filtered by low monthly listeners and having label set.
   */
  async listUndergroundArtists(
    cursor: string | undefined,
    limit: number,
    opts: { minListeners?: number; maxListeners?: number; label?: string } = {},
  ): Promise<{
    items: Prisma.ArtistGetPayload<{ include: typeof artistInclude }>[];
    nextCursor: string | null;
  }> {
    const { minListeners = 0, maxListeners = 10000, label = 'underground' } = opts;

    const rows = await prisma.artist.findMany({
      where: {
        label: { equals: label },
        monthlyListeners: { gte: minListeners, lte: maxListeners },
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: artistInclude,
      orderBy: [{ monthlyListeners: 'asc' }, { id: 'desc' }],
      take: limit + 1,
    });

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const nextItem = rows.pop()!;
      nextCursor = nextItem.id;
    }

    return { items: rows, nextCursor };
  },

  /**
   * Search underground artists by name/genre/location
   */
  async searchUndergroundArtists(
    query: string,
    limit: number,
    opts: { label?: string; location?: string } = {},
  ): Promise<Prisma.ArtistGetPayload<{ include: typeof artistInclude }>[]> {
    const { label = 'underground', location } = opts;

    return prisma.artist.findMany({
      where: {
        label: { equals: label },
        AND: [
          query
            ? {
                OR: [
                  { name: { contains: query, mode: 'insensitive' } },
                  { bio: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {},
          location ? { location: { contains: location, mode: 'insensitive' } } : {},
        ],
      },
      include: artistInclude,
      orderBy: { monthlyListeners: 'asc' },
      take: limit,
    });
  },

  /**
   * Get tracks from underground artists with pagination
   */
  async getUndergroundTracks(
    cursor: string | undefined,
    limit: number,
    opts: { label?: string; genre?: string } = {},
  ): Promise<{
    items: Prisma.TrackGetPayload<{
      include: typeof import('../shared/mappers.js').trackInclude;
    }>[];
    nextCursor: string | null;
  }> {
    const { label = 'underground', genre } = opts;

    const trackInclude = (await import('../shared/mappers.js')).trackInclude;

    const rows = await prisma.track.findMany({
      where: {
        isPublic: true,
        artists: {
          some: {
            artist: {
              label: { equals: label },
            },
          },
        },
        ...(genre
          ? { genres: { some: { genre: { name: { equals: genre, mode: 'insensitive' } } } } }
          : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: trackInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const nextItem = rows.pop()!;
      nextCursor = nextItem.id;
    }

    return { items: rows, nextCursor };
  },

  /**
   * Get genres from underground artists
   */
  async getUndergroundGenres(label: string = 'underground'): Promise<string[]> {
    const genres = await prisma.genre.findMany({
      where: {
        artists: {
          some: { artist: { label: { equals: label } } },
        },
      },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return genres.map((g) => g.name);
  },

  /**
   * Get locations from underground artists
   */
  async getUndergroundLocations(label: string = 'underground'): Promise<string[]> {
    const artists = await prisma.artist.findMany({
      where: {
        label: { equals: label },
        location: { not: null },
      },
      select: { location: true },
      distinct: ['location'],
    });
    return artists.map((a) => a.location!).filter(Boolean);
  },

  /**
   * Get trending underground tracks (by plays in last 7 days)
   */
  async getTrendingUndergroundTracks(
    limit: number,
    label: string = 'underground',
    days: number = 7,
  ): Promise<
    Prisma.TrackGetPayload<{ include: typeof import('../shared/mappers.js').trackInclude }>[]
  > {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const trackInclude = (await import('../shared/mappers.js')).trackInclude;

    return prisma.track.findMany({
      where: {
        isPublic: true,
        playsCount: { gt: 0 },
        createdAt: { gte: since },
        artists: {
          some: {
            artist: {
              label: { equals: label },
            },
          },
        },
      },
      include: trackInclude,
      orderBy: { playsCount: 'desc' },
      take: limit,
    });
  },
};
