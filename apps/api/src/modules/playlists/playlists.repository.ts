import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { cursorWhere } from '../../core/http/pagination.js';
import {
  playlistInclude,
  trackInclude,
  type PlaylistRow,
  type TrackRow,
} from '../shared/mappers.js';

/** Large offset used for two-phase position updates — the (playlistId, position)
 *  unique constraint would otherwise trip on intermediate states. */
const POSITION_OFFSET = 1_000_000;

export interface PlaylistEntryRecord {
  id: string;
  position: number;
  addedAt: Date;
  addedById: string | null;
  track: TrackRow;
}

export interface PlaylistAccessRecord {
  id: string;
  ownerId: string;
  isPublic: boolean;
  isCollaborative: boolean;
  collaboratorIds: string[];
}

export const playlistsRepository = {
  listForUser(userId: string, cursor: string | undefined, limit: number): Promise<PlaylistRow[]> {
    return prisma.playlist.findMany({
      where: {
        AND: [
          { OR: [{ ownerId: userId }, { collaborators: { some: { userId } } }] },
          cursorWhere(cursor) ?? {},
        ],
      },
      include: playlistInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  findById(id: string): Promise<PlaylistRow | null> {
    return prisma.playlist.findUnique({ where: { id }, include: playlistInclude });
  },

  async findAccess(id: string): Promise<PlaylistAccessRecord | null> {
    const row = await prisma.playlist.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        isPublic: true,
        isCollaborative: true,
        collaborators: { select: { userId: true } },
      },
    });
    if (!row) return null;
    return { ...row, collaboratorIds: row.collaborators.map((c) => c.userId) };
  },

  create(
    ownerId: string,
    data: Pick<
      Prisma.PlaylistUncheckedCreateInput,
      'title' | 'description' | 'isPublic' | 'isCollaborative'
    >,
  ): Promise<PlaylistRow> {
    return prisma.playlist.create({ data: { ...data, ownerId }, include: playlistInclude });
  },

  update(id: string, data: Prisma.PlaylistUpdateInput): Promise<PlaylistRow> {
    return prisma.playlist.update({ where: { id }, data, include: playlistInclude });
  },

  async delete(id: string): Promise<void> {
    await prisma.playlist.delete({ where: { id } });
  },

  entries(playlistId: string): Promise<PlaylistEntryRecord[]> {
    return prisma.playlistTrack.findMany({
      where: { playlistId },
      select: {
        id: true,
        position: true,
        addedAt: true,
        addedById: true,
        track: { include: trackInclude },
      },
      orderBy: { position: 'asc' },
    });
  },

  entryIdsOrdered(playlistId: string): Promise<string[]> {
    return prisma.playlistTrack
      .findMany({ where: { playlistId }, select: { id: true }, orderBy: { position: 'asc' } })
      .then((rows) => rows.map((r) => r.id));
  },

  countExistingTracks(trackIds: string[]): Promise<number> {
    return prisma.track.count({ where: { id: { in: trackIds } } });
  },

  /** Users referenced by PlaylistTrack.addedById (no Prisma relation on purpose). */
  usersByIds(ids: string[]): Promise<Array<{ id: string; handle: string; displayName: string }>> {
    return prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, handle: true, displayName: true },
    });
  },

  async insertTracks(
    playlistId: string,
    trackIds: string[],
    position: number | undefined,
    addedById: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const count = await tx.playlistTrack.count({ where: { playlistId } });
      const pos = position === undefined ? count : Math.min(Math.max(position, 0), count);
      if (pos < count) {
        await tx.playlistTrack.updateMany({
          where: { playlistId, position: { gte: pos } },
          data: { position: { increment: POSITION_OFFSET + trackIds.length } },
        });
        await tx.playlistTrack.updateMany({
          where: { playlistId, position: { gte: POSITION_OFFSET } },
          data: { position: { decrement: POSITION_OFFSET } },
        });
      }
      await tx.playlistTrack.createMany({
        data: trackIds.map((trackId, i) => ({ playlistId, trackId, position: pos + i, addedById })),
      });
      await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
    });
  },

  async removeEntries(playlistId: string, entryIds: string[]): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.playlistTrack.deleteMany({
        where: { playlistId, id: { in: entryIds } },
      });
      if (count > 0) {
        const remaining = await tx.playlistTrack.findMany({
          where: { playlistId },
          select: { id: true },
          orderBy: { position: 'asc' },
        });
        await tx.playlistTrack.updateMany({
          where: { playlistId },
          data: { position: { increment: POSITION_OFFSET } },
        });
        for (let i = 0; i < remaining.length; i += 1) {
          const row = remaining[i];
          if (!row) continue;
          await tx.playlistTrack.update({ where: { id: row.id }, data: { position: i } });
        }
        await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
      }
      return count;
    });
  },

  /** Rewrites all entry positions to match the given order (two-phase). */
  async replacePositions(playlistId: string, orderedEntryIds: string[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.playlistTrack.updateMany({
        where: { playlistId },
        data: { position: { increment: POSITION_OFFSET } },
      });
      for (let i = 0; i < orderedEntryIds.length; i += 1) {
        const id = orderedEntryIds[i];
        if (!id) continue;
        await tx.playlistTrack.update({ where: { id }, data: { position: i } });
      }
      await tx.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
    });
  },

  async addCollaborator(playlistId: string, userId: string): Promise<void> {
    await prisma.playlistCollaborator.upsert({
      where: { playlistId_userId: { playlistId, userId } },
      update: {},
      create: { playlistId, userId },
    });
  },

  userExists(userId: string): Promise<boolean> {
    return prisma.user.findUnique({ where: { id: userId }, select: { id: true } }).then(Boolean);
  },
};
