import { prisma } from '../../infra/db/prisma.js';
import { decodeCursor } from '../../core/http/pagination.js';
import {
  albumInclude,
  artistInclude,
  playlistInclude,
  trackInclude,
  type AlbumRow,
  type ArtistRow,
  type PlaylistRow,
  type TrackRow,
} from '../shared/mappers.js';

export interface LikedTrackEntry {
  createdAt: Date;
  track: TrackRow;
}

export const libraryRepository = {
  /** Which of `trackIds` the user has liked — used for isLiked overlays everywhere. */
  async likedTrackIdSet(userId: string, trackIds: string[]): Promise<Set<string>> {
    if (trackIds.length === 0) return new Set();
    const rows = await prisma.likedTrack.findMany({
      where: { userId, trackId: { in: trackIds } },
      select: { trackId: true },
    });
    return new Set(rows.map((r) => r.trackId));
  },

  playlists(userId: string, limit: number): Promise<PlaylistRow[]> {
    return prisma.playlist.findMany({
      where: { OR: [{ ownerId: userId }, { collaborators: { some: { userId } } }] },
      include: playlistInclude,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  },

  likedAlbums(userId: string, limit: number): Promise<AlbumRow[]> {
    return prisma.likedAlbum
      .findMany({
        where: { userId },
        include: { album: { include: albumInclude } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      .then((rows) => rows.map((r) => r.album));
  },

  followedArtists(userId: string, limit: number): Promise<ArtistRow[]> {
    return prisma.artistFollow
      .findMany({
        where: { userId },
        include: { artist: { include: artistInclude } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      .then((rows) => rows.map((r) => r.artist));
  },

  likedTracksCount(userId: string): Promise<number> {
    return prisma.likedTrack.count({ where: { userId } });
  },

  /** Liked tracks page — LikedTrack has a composite pk, so the keyset
   *  tiebreaker is trackId (the generic cursorWhere assumes an `id` column). */
  likedTracks(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<LikedTrackEntry[]> {
    const point = cursor ? decodeCursor(cursor) : undefined;
    return prisma.likedTrack.findMany({
      where: {
        userId,
        ...(point
          ? {
              OR: [
                { createdAt: { lt: point.date } },
                { AND: [{ createdAt: point.date }, { trackId: { lt: point.id } }] },
              ],
            }
          : {}),
      },
      select: { createdAt: true, track: { include: trackInclude } },
      orderBy: [{ createdAt: 'desc' }, { trackId: 'desc' }],
      take: limit + 1,
    });
  },

  trackTitle(trackId: string): Promise<{ id: string; title: string } | null> {
    return prisma.track.findUnique({ where: { id: trackId }, select: { id: true, title: true } });
  },

  albumExists(albumId: string): Promise<boolean> {
    return prisma.album.findUnique({ where: { id: albumId }, select: { id: true } }).then(Boolean);
  },

  async likeTrack(userId: string, trackId: string): Promise<void> {
    await prisma.likedTrack.upsert({
      where: { userId_trackId: { userId, trackId } },
      update: {},
      create: { userId, trackId },
    });
  },

  async unlikeTrack(userId: string, trackId: string): Promise<void> {
    await prisma.likedTrack.deleteMany({ where: { userId, trackId } });
  },

  async likeAlbum(userId: string, albumId: string): Promise<void> {
    await prisma.likedAlbum.upsert({
      where: { userId_albumId: { userId, albumId } },
      update: {},
      create: { userId, albumId },
    });
  },

  async unlikeAlbum(userId: string, albumId: string): Promise<void> {
    await prisma.likedAlbum.deleteMany({ where: { userId, albumId } });
  },
};
