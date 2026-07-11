import { prisma } from '../../infra/db/prisma.js';
import { trackInclude, type TrackRow } from '../shared/mappers.js';

export interface TasteProfile {
  topGenreIds: string[];
  topArtistIds: string[];
  recentTrackIds: string[];
}

export const recommendationsRepository = {
  /** Taste signal = recent history + likes, aggregated to genres/artists. */
  async tasteProfile(userId: string): Promise<TasteProfile> {
    const [history, likes] = await Promise.all([
      prisma.playHistory.findMany({
        where: { userId },
        select: { trackId: true },
        orderBy: { playedAt: 'desc' },
        take: 200,
      }),
      prisma.likedTrack.findMany({
        where: { userId },
        select: { trackId: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    const trackIds = [
      ...new Set([...history.map((h) => h.trackId), ...likes.map((l) => l.trackId)]),
    ];
    if (trackIds.length === 0) return { topGenreIds: [], topArtistIds: [], recentTrackIds: [] };

    const [genreRows, artistRows] = await Promise.all([
      prisma.trackGenre.groupBy({
        by: ['genreId'],
        where: { trackId: { in: trackIds } },
        _count: { genreId: true },
        orderBy: { _count: { genreId: 'desc' } },
        take: 6,
      }),
      prisma.trackArtist.groupBy({
        by: ['artistId'],
        where: { trackId: { in: trackIds } },
        _count: { artistId: true },
        orderBy: { _count: { artistId: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      topGenreIds: genreRows.map((g) => g.genreId),
      topArtistIds: artistRows.map((a) => a.artistId),
      recentTrackIds: history.slice(0, 50).map((h) => h.trackId),
    };
  },

  tracksByGenres(
    genreIds: string[],
    excludeTrackIds: string[],
    limit: number,
  ): Promise<TrackRow[]> {
    return prisma.track.findMany({
      where: {
        isPublic: true,
        id: { notIn: excludeTrackIds },
        genres: { some: { genreId: { in: genreIds } } },
      },
      include: trackInclude,
      orderBy: [{ playsCount: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  },

  tracksByArtists(
    artistIds: string[],
    excludeTrackIds: string[],
    limit: number,
  ): Promise<TrackRow[]> {
    return prisma.track.findMany({
      where: {
        isPublic: true,
        id: { notIn: excludeTrackIds },
        artists: { some: { artistId: { in: artistIds } } },
      },
      include: trackInclude,
      orderBy: [{ playsCount: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  },

  /** Low-play-count tracks outside the user's known artists (discovery). */
  discoverTracks(
    excludeArtistIds: string[],
    excludeTrackIds: string[],
    limit: number,
  ): Promise<TrackRow[]> {
    return prisma.track.findMany({
      where: {
        isPublic: true,
        id: { notIn: excludeTrackIds },
        ...(excludeArtistIds.length > 0
          ? { artists: { none: { artistId: { in: excludeArtistIds } } } }
          : {}),
      },
      include: trackInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  },

  genresBySlugs(slugs: string[]): Promise<Array<{ id: string }>> {
    return prisma.genre.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
  },

  trackSeed(trackId: string): Promise<{ genreIds: string[]; artistIds: string[] } | null> {
    return prisma.track
      .findUnique({
        where: { id: trackId },
        select: {
          genres: { select: { genreId: true } },
          artists: { select: { artistId: true } },
        },
      })
      .then((row) =>
        row
          ? {
              genreIds: row.genres.map((g) => g.genreId),
              artistIds: row.artists.map((a) => a.artistId),
            }
          : null,
      );
  },

  trending(limit: number): Promise<TrackRow[]> {
    return prisma.track.findMany({
      where: { isPublic: true },
      include: trackInclude,
      orderBy: [{ playsCount: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  },
};
