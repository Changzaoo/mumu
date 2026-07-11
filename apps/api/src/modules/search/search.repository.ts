import { prisma } from '../../infra/db/prisma.js';
import {
  albumInclude,
  artistInclude,
  playlistInclude,
  podcastInclude,
  trackInclude,
  userInclude,
  type AlbumRow,
  type ArtistRow,
  type PlaylistRow,
  type PodcastRow,
  type TrackRow,
  type UserRow,
} from '../shared/mappers.js';

/**
 * `terms` = AND of word-level insensitive contains — a cheap trigram-ish
 * fallback that survives word reordering ("daft homework" still matches).
 * Deliberate `any`: computed-key fragments cannot satisfy each model's
 * WhereInput structurally (same rationale as core cursorWhere).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function containsAll(field: string, terms: string[]): any {
  return { AND: terms.map((t) => ({ [field]: { contains: t, mode: 'insensitive' } })) };
}

export const searchRepository = {
  tracks(terms: string[], limit: number): Promise<TrackRow[]> {
    return prisma.track.findMany({
      where: { isPublic: true, ...containsAll('title', terms) },
      include: trackInclude,
      orderBy: { playsCount: 'desc' },
      take: limit,
    });
  },

  /** Tracks whose artist matches — merged in by the service when title search is thin. */
  tracksByArtist(terms: string[], limit: number): Promise<TrackRow[]> {
    return prisma.track.findMany({
      where: {
        isPublic: true,
        artists: { some: { artist: containsAll('name', terms) } },
      },
      include: trackInclude,
      orderBy: { playsCount: 'desc' },
      take: limit,
    });
  },

  albums(terms: string[], limit: number): Promise<AlbumRow[]> {
    return prisma.album.findMany({
      where: containsAll('title', terms),
      include: albumInclude,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  artists(terms: string[], limit: number): Promise<ArtistRow[]> {
    return prisma.artist.findMany({
      where: containsAll('name', terms),
      include: artistInclude,
      orderBy: { monthlyListeners: 'desc' },
      take: limit,
    });
  },

  playlists(terms: string[], limit: number): Promise<PlaylistRow[]> {
    return prisma.playlist.findMany({
      where: { isPublic: true, ...containsAll('title', terms) },
      include: playlistInclude,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  },

  podcasts(terms: string[], limit: number): Promise<PodcastRow[]> {
    return prisma.podcast.findMany({
      where: containsAll('title', terms),
      include: podcastInclude,
      take: limit,
    });
  },

  radios(terms: string[], limit: number) {
    return prisma.radioStation.findMany({
      where: containsAll('name', terms),
      take: limit,
    });
  },

  users(terms: string[], limit: number): Promise<UserRow[]> {
    return prisma.user.findMany({
      where: {
        isBanned: false,
        OR: [containsAll('displayName', terms), containsAll('handle', terms)],
      },
      include: userInclude,
      take: limit,
    });
  },

  // ── autocomplete (prefix matches) ──
  artistPrefix(q: string, limit: number) {
    return prisma.artist.findMany({
      where: { name: { startsWith: q, mode: 'insensitive' } },
      select: { id: true, name: true, imageUrl: true },
      orderBy: { monthlyListeners: 'desc' },
      take: limit,
    });
  },

  trackPrefix(q: string, limit: number) {
    return prisma.track.findMany({
      where: { isPublic: true, title: { startsWith: q, mode: 'insensitive' } },
      select: { id: true, title: true, coverUrl: true },
      orderBy: { playsCount: 'desc' },
      take: limit,
    });
  },

  albumPrefix(q: string, limit: number) {
    return prisma.album.findMany({
      where: { title: { startsWith: q, mode: 'insensitive' } },
      select: { id: true, title: true, coverUrl: true },
      take: limit,
    });
  },
};
