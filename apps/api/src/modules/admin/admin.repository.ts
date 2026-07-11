import { Prisma, type Upload } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { userInclude, type UserRow } from '../shared/mappers.js';

export interface PlaysPerDay {
  day: string;
  plays: number;
  uniqueListeners: number;
}

export const adminRepository = {
  async userCounts(startOfDay: Date, weekAgo: Date) {
    const [total, activeToday, newThisWeek] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { lastSeenAt: { gte: startOfDay } } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    ]);
    return { total, activeToday, newThisWeek };
  },

  async trackCounts(startOfDay: Date) {
    const [total, processedToday] = await Promise.all([
      prisma.track.count(),
      prisma.track.count({ where: { createdAt: { gte: startOfDay } } }),
    ]);
    return { total, processedToday };
  },

  async uploadCounts(startOfDay: Date) {
    const [queued, processing, failedToday] = await Promise.all([
      prisma.upload.count({ where: { status: 'QUEUED' } }),
      prisma.upload.count({ where: { status: { in: ['PROBING', 'TRANSCODING', 'ANALYZING'] } } }),
      prisma.upload.count({ where: { status: 'FAILED', updatedAt: { gte: startOfDay } } }),
    ]);
    return { queued, processing, failedToday };
  },

  async storageStats() {
    const agg = await prisma.upload.aggregate({ _sum: { sizeBytes: true }, _count: true });
    return {
      usedBytes: Number(agg._sum.sizeBytes ?? 0n),
      objectCount: agg._count,
    };
  },

  async playbackToday(startOfDay: Date) {
    const agg = await prisma.playHistory.aggregate({
      where: { playedAt: { gte: startOfDay } },
      _sum: { playedMs: true },
      _count: true,
    });
    return {
      playsToday: agg._count,
      listeningHoursToday: Math.round(((agg._sum.playedMs ?? 0) / 3_600_000) * 10) / 10,
    };
  },

  users(q: string | undefined, page: number, perPage: number): Promise<[UserRow[], number]> {
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { handle: { contains: q, mode: 'insensitive' } },
            { displayName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    return Promise.all([
      prisma.user.findMany({
        where,
        include: userInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.user.count({ where }),
    ]);
  },

  updateUser(id: string, data: Prisma.UserUpdateInput): Promise<UserRow> {
    return prisma.user.update({ where: { id }, data, include: userInclude });
  },

  userExists(id: string): Promise<boolean> {
    return prisma.user.findUnique({ where: { id }, select: { id: true } }).then(Boolean);
  },

  uploads(status: string | undefined, page: number, perPage: number): Promise<[Upload[], number]> {
    const where: Prisma.UploadWhereInput = status ? { status: status as Upload['status'] } : {};
    return Promise.all([
      prisma.upload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.upload.count({ where }),
    ]);
  },

  auditLogs(page: number, perPage: number) {
    return Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.auditLog.count(),
    ]);
  },

  async writeAudit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  },

  /** analytics-lite: plays per day for the last N days (raw SQL for date_trunc). */
  async playsPerDay(days: number): Promise<PlaysPerDay[]> {
    const rows = await prisma.$queryRaw<
      Array<{ day: Date; plays: bigint; unique_listeners: bigint }>
    >(
      Prisma.sql`
        SELECT date_trunc('day', "playedAt") AS day,
               count(*) AS plays,
               count(DISTINCT "userId") AS unique_listeners
        FROM "PlayHistory"
        WHERE "playedAt" >= now() - make_interval(days => ${days})
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    );
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      plays: Number(r.plays),
      uniqueListeners: Number(r.unique_listeners),
    }));
  },
};
