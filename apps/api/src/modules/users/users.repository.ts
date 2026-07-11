import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { cursorWhere } from '../../core/http/pagination.js';
import { playlistInclude, userInclude, type PlaylistRow, type UserRow } from '../shared/mappers.js';

export const usersRepository = {
  findById(id: string): Promise<UserRow | null> {
    return prisma.user.findUnique({ where: { id }, include: userInclude });
  },

  findByHandle(handle: string): Promise<UserRow | null> {
    return prisma.user.findUnique({ where: { handle }, include: userInclude });
  },

  update(id: string, data: Prisma.UserUpdateInput): Promise<UserRow> {
    return prisma.user.update({ where: { id }, data, include: userInclude });
  },

  publicPlaylists(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<PlaylistRow[]> {
    return prisma.playlist.findMany({
      where: { AND: [{ ownerId: userId, isPublic: true }, cursorWhere(cursor) ?? {}] },
      include: playlistInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  async follow(followerId: string, followeeId: string): Promise<void> {
    await prisma.userFollow.upsert({
      where: { followerId_followeeId: { followerId, followeeId } },
      update: {},
      create: { followerId, followeeId },
    });
  },

  async unfollow(followerId: string, followeeId: string): Promise<void> {
    await prisma.userFollow.deleteMany({ where: { followerId, followeeId } });
  },

  async isFollowedBy(followerId: string, followeeId: string): Promise<boolean> {
    const row = await prisma.userFollow.findUnique({
      where: { followerId_followeeId: { followerId, followeeId } },
      select: { followerId: true },
    });
    return row !== null;
  },

  listeningAggregate(
    userId: string,
  ): Promise<{ _sum: { playedMs: number | null }; _count: number }> {
    return prisma.playHistory.aggregate({
      where: { userId },
      _sum: { playedMs: true },
      _count: true,
    });
  },

  topPlayedTrackIds(
    userId: string,
    take: number,
  ): Promise<Array<{ trackId: string; plays: number }>> {
    return prisma.playHistory
      .groupBy({
        by: ['trackId'],
        where: { userId },
        _count: { trackId: true },
        orderBy: { _count: { trackId: 'desc' } },
        take,
      })
      .then((rows) => rows.map((r) => ({ trackId: r.trackId, plays: r._count.trackId })));
  },

  tracksWithRelations(trackIds: string[]) {
    return prisma.track.findMany({
      where: { id: { in: trackIds } },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        artists: { select: { artist: { select: { id: true, name: true, imageUrl: true } } } },
        genres: { select: { genre: { select: { name: true } } } },
      },
    });
  },

  badges(userId: string) {
    return prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
      orderBy: { earnedAt: 'asc' },
    });
  },
};
