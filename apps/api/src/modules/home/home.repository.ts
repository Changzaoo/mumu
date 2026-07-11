import { prisma } from '../../infra/db/prisma.js';
import {
  albumInclude,
  artistInclude,
  podcastInclude,
  trackInclude,
  type AlbumRow,
  type ArtistRow,
  type PodcastRow,
  type TrackRow,
} from '../shared/mappers.js';

export const homeRepository = {
  recentTrackIds(userId: string, limit: number): Promise<string[]> {
    return prisma.playHistory
      .findMany({
        where: { userId },
        select: { trackId: true },
        orderBy: { playedAt: 'desc' },
        take: limit * 4,
      })
      .then((rows) => [...new Set(rows.map((r) => r.trackId))].slice(0, limit));
  },

  tracksByIds(ids: string[]): Promise<TrackRow[]> {
    return prisma.track.findMany({ where: { id: { in: ids } }, include: trackInclude });
  },

  trending(limit: number): Promise<TrackRow[]> {
    return prisma.track.findMany({
      where: { isPublic: true },
      include: trackInclude,
      orderBy: [{ playsCount: 'desc' }, { id: 'desc' }],
      take: limit,
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

  popularArtists(limit: number): Promise<ArtistRow[]> {
    return prisma.artist.findMany({
      include: artistInclude,
      orderBy: { monthlyListeners: 'desc' },
      take: limit,
    });
  },

  /** User's most-played genres → fresh tracks in those genres (not recently played). */
  async recommendedByGenres(
    userId: string,
    excludeTrackIds: string[],
    limit: number,
  ): Promise<TrackRow[]> {
    const recentGenres = await prisma.trackGenre.groupBy({
      by: ['genreId'],
      where: { track: { playHistory: { some: { userId } } } },
      _count: { genreId: true },
      orderBy: { _count: { genreId: 'desc' } },
      take: 5,
    });
    const genreIds = recentGenres.map((g) => g.genreId);
    if (genreIds.length === 0) return [];
    return prisma.track.findMany({
      where: {
        isPublic: true,
        id: { notIn: excludeTrackIds },
        genres: { some: { genreId: { in: genreIds } } },
      },
      include: trackInclude,
      orderBy: { playsCount: 'desc' },
      take: limit,
    });
  },

  radios(limit: number) {
    return prisma.radioStation.findMany({ take: limit });
  },

  podcasts(limit: number): Promise<PodcastRow[]> {
    return prisma.podcast.findMany({
      include: podcastInclude,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};
