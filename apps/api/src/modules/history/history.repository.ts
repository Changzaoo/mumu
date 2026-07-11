import type { PlaySource, Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { cursorWhere } from '../../core/http/pagination.js';
import { trackInclude, type TrackRow } from '../shared/mappers.js';

export interface HistoryRow {
  id: string;
  playedAt: Date;
  playedMs: number;
  positionMs: number | null;
  completed: boolean;
  source: PlaySource;
  sourceId: string | null;
  track: TrackRow;
}

const historySelect = {
  id: true,
  playedAt: true,
  playedMs: true,
  positionMs: true,
  completed: true,
  source: true,
  sourceId: true,
  track: { include: trackInclude },
} satisfies Prisma.PlayHistorySelect;

export const historyRepository = {
  async record(data: {
    userId: string;
    trackId: string;
    playedMs: number;
    positionMs: number | null;
    completed: boolean;
    source: PlaySource;
    sourceId: string | null;
  }): Promise<{ id: string }> {
    const [row] = await prisma.$transaction([
      prisma.playHistory.create({ data, select: { id: true } }),
      prisma.track.update({ where: { id: data.trackId }, data: { playsCount: { increment: 1 } } }),
    ]);
    return row;
  },

  trackTitle(trackId: string): Promise<{ id: string; title: string } | null> {
    return prisma.track.findUnique({ where: { id: trackId }, select: { id: true, title: true } });
  },

  list(userId: string, cursor: string | undefined, limit: number): Promise<HistoryRow[]> {
    return prisma.playHistory.findMany({
      where: { AND: [{ userId }, cursorWhere(cursor, 'playedAt') ?? {}] },
      select: historySelect,
      orderBy: [{ playedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  recent(userId: string, limit: number): Promise<HistoryRow[]> {
    return prisma.playHistory.findMany({
      where: { userId },
      select: historySelect,
      orderBy: { playedAt: 'desc' },
      take: limit,
    });
  },

  /** Latest unfinished plays with a resume point (continue listening). */
  resumable(userId: string, limit: number): Promise<HistoryRow[]> {
    return prisma.playHistory.findMany({
      where: { userId, completed: false, positionMs: { not: null, gt: 10_000 } },
      select: historySelect,
      orderBy: { playedAt: 'desc' },
      take: limit * 3, // deduped per-track by the service
    });
  },

  async clear(userId: string): Promise<number> {
    const { count } = await prisma.playHistory.deleteMany({ where: { userId } });
    return count;
  },

  albumTitle(id: string): Promise<{ title: string } | null> {
    return prisma.album.findUnique({ where: { id }, select: { title: true } });
  },

  playlistTitle(id: string): Promise<{ title: string } | null> {
    return prisma.playlist.findUnique({ where: { id }, select: { title: true } });
  },
};
