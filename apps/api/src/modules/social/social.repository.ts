import type { FeedEventType, Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { cursorWhere } from '../../core/http/pagination.js';
import {
  commentInclude,
  listenSessionInclude,
  trackInclude,
  type CommentRow,
  type ListenSessionRow,
  type TrackRow,
} from '../shared/mappers.js';

export interface FeedRow {
  id: string;
  type: FeedEventType;
  trackId: string | null;
  targetId: string | null;
  targetTitle: string | null;
  createdAt: Date;
  actor: { id: string; handle: string; displayName: string; avatarUrl: string | null };
}

const feedSelect = {
  id: true,
  type: true,
  trackId: true,
  targetId: true,
  targetTitle: true,
  createdAt: true,
  actor: { select: { id: true, handle: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.FeedEventSelect;

export const socialRepository = {
  // ── comments ──
  createComment(trackId: string, userId: string, body: string): Promise<CommentRow> {
    return prisma.comment.create({ data: { trackId, userId, body }, include: commentInclude });
  },

  comments(trackId: string, cursor: string | undefined, limit: number): Promise<CommentRow[]> {
    return prisma.comment.findMany({
      where: { AND: [{ trackId }, cursorWhere(cursor) ?? {}] },
      include: commentInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  findComment(id: string): Promise<CommentRow | null> {
    return prisma.comment.findUnique({ where: { id }, include: commentInclude });
  },

  async deleteComment(id: string): Promise<void> {
    await prisma.comment.delete({ where: { id } });
  },

  async likeComment(commentId: string, userId: string): Promise<void> {
    await prisma.commentLike.upsert({
      where: { commentId_userId: { commentId, userId } },
      update: {},
      create: { commentId, userId },
    });
  },

  async unlikeComment(commentId: string, userId: string): Promise<void> {
    await prisma.commentLike.deleteMany({ where: { commentId, userId } });
  },

  async likedCommentIdSet(userId: string, commentIds: string[]): Promise<Set<string>> {
    if (commentIds.length === 0) return new Set();
    const rows = await prisma.commentLike.findMany({
      where: { userId, commentId: { in: commentIds } },
      select: { commentId: true },
    });
    return new Set(rows.map((r) => r.commentId));
  },

  trackExists(trackId: string): Promise<boolean> {
    return prisma.track.findUnique({ where: { id: trackId }, select: { id: true } }).then(Boolean);
  },

  // ── feed ──
  async createFeedEvent(data: Prisma.FeedEventUncheckedCreateInput): Promise<void> {
    await prisma.feedEvent.create({ data });
  },

  async feed(userId: string, cursor: string | undefined, limit: number): Promise<FeedRow[]> {
    const following = await prisma.userFollow.findMany({
      where: { followerId: userId },
      select: { followeeId: true },
    });
    const actorIds = [userId, ...following.map((f) => f.followeeId)];
    return prisma.feedEvent.findMany({
      where: { AND: [{ actorId: { in: actorIds } }, cursorWhere(cursor) ?? {}] },
      select: feedSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  },

  tracksByIds(ids: string[]): Promise<TrackRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.track.findMany({ where: { id: { in: ids } }, include: trackInclude });
  },

  // ── listen sessions ──
  createSession(hostUserId: string, trackId: string | null): Promise<ListenSessionRow> {
    return prisma.listenSession.create({
      data: {
        hostUserId,
        trackId,
        members: { create: { userId: hostUserId } },
      },
      include: listenSessionInclude,
    });
  },

  findSession(id: string): Promise<ListenSessionRow | null> {
    return prisma.listenSession.findUnique({ where: { id }, include: listenSessionInclude });
  },

  async joinSession(sessionId: string, userId: string): Promise<void> {
    await prisma.listenSessionMember.upsert({
      where: { sessionId_userId: { sessionId, userId } },
      update: {},
      create: { sessionId, userId },
    });
  },

  async leaveSession(sessionId: string, userId: string): Promise<void> {
    await prisma.listenSessionMember.deleteMany({ where: { sessionId, userId } });
  },

  async updateSessionState(
    sessionId: string,
    state: { trackId: string | null; positionMs: number; isPlaying: boolean },
  ): Promise<void> {
    await prisma.listenSession.update({ where: { id: sessionId }, data: state });
  },

  async endSession(sessionId: string): Promise<void> {
    await prisma.listenSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date(), isPlaying: false },
    });
  },
};
