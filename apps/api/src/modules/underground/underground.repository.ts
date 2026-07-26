import { cursorWhere, numericCursorWhere } from '../../core/http/pagination.js';
import { prisma } from '../../infra/db/prisma.js';
import { artistInclude, trackInclude, type ArtistRow, type TrackRow } from '../shared/mappers.js';

/** Default curation tag the underground shelves are built from. */
export const DEFAULT_CATALOG_TAG = 'underground';

export const undergroundRepository = {
  /**
   * Artists carrying the catalog tag, quietest first — the whole point is
   * surfacing people the big shelves never show.
   */
  listArtists(
    cursor: string | undefined,
    limit: number,
    opts: { minListeners?: number; maxListeners?: number; catalogTag?: string } = {},
  ): Promise<ArtistRow[]> {
    const { minListeners, maxListeners, catalogTag = DEFAULT_CATALOG_TAG } = opts;

    return prisma.artist.findMany({
      where: {
        catalogTag,
        ...(minListeners !== undefined || maxListeners !== undefined
          ? {
              monthlyListeners: {
                ...(minListeners !== undefined ? { gte: minListeners } : {}),
                ...(maxListeners !== undefined ? { lte: maxListeners } : {}),
              },
            }
          : {}),
        ...numericCursorWhere(cursor, 'monthlyListeners'),
      },
      include: artistInclude,
      orderBy: [{ monthlyListeners: 'asc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  searchArtists(
    query: string,
    limit: number,
    opts: { catalogTag?: string; location?: string } = {},
  ): Promise<ArtistRow[]> {
    const { catalogTag = DEFAULT_CATALOG_TAG, location } = opts;

    return prisma.artist.findMany({
      where: {
        catalogTag,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { bio: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(location ? { location: { contains: location, mode: 'insensitive' } } : {}),
      },
      include: artistInclude,
      orderBy: [{ monthlyListeners: 'asc' }, { id: 'desc' }],
      take: limit,
    });
  },

  /** Newest public tracks by tagged artists. */
  listTracks(
    cursor: string | undefined,
    limit: number,
    opts: { catalogTag?: string; genre?: string } = {},
  ): Promise<TrackRow[]> {
    const { catalogTag = DEFAULT_CATALOG_TAG, genre } = opts;

    return prisma.track.findMany({
      where: {
        isPublic: true,
        artists: { some: { artist: { catalogTag } } },
        ...(genre
          ? { genres: { some: { genre: { name: { equals: genre, mode: 'insensitive' } } } } }
          : {}),
        ...cursorWhere(cursor),
      },
      include: trackInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  async listGenres(catalogTag: string = DEFAULT_CATALOG_TAG): Promise<string[]> {
    const genres = await prisma.genre.findMany({
      where: { artists: { some: { artist: { catalogTag } } } },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return genres.map((g) => g.name);
  },

  async listLocations(catalogTag: string = DEFAULT_CATALOG_TAG): Promise<string[]> {
    const artists = await prisma.artist.findMany({
      where: { catalogTag, location: { not: null } },
      select: { location: true },
      distinct: ['location'],
      orderBy: { location: 'asc' },
    });
    return artists.map((a) => a.location).filter((l): l is string => Boolean(l));
  },

  /**
   * Most-played tagged tracks within the window.
   *
   * Ranked by plays actually logged in the window (via PlayHistory) rather than
   * by lifetime `playsCount` — otherwise "trending" just means "oldest popular
   * track", which is the opposite of the intent.
   */
  async listTrendingTracks(
    limit: number,
    catalogTag: string = DEFAULT_CATALOG_TAG,
    days: number = 7,
  ): Promise<TrackRow[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const ranked = await prisma.playHistory.groupBy({
      by: ['trackId'],
      where: {
        playedAt: { gte: since },
        track: { isPublic: true, artists: { some: { artist: { catalogTag } } } },
      },
      _count: { trackId: true },
      orderBy: { _count: { trackId: 'desc' } },
      take: limit,
    });
    if (ranked.length === 0) return [];

    const rows = await prisma.track.findMany({
      where: { id: { in: ranked.map((r) => r.trackId) } },
      include: trackInclude,
    });

    // findMany drops the ranking, so restore the groupBy order.
    const rank = new Map(ranked.map((r, index) => [r.trackId, index]));
    return rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  },
};
