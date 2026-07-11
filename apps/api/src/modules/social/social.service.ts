import type { CommentDto, FeedEventDto, ListenSessionDto } from '@aurial/shared';
import { ForbiddenError, NotFoundError } from '../../core/errors/index.js';
import { takePage, type CursorPage } from '../../core/http/pagination.js';
import { toCommentDto, toListenSessionDto, toTrackDto } from '../shared/mappers.js';
import { socialRepository } from './social.repository.js';

export const socialService = {
  // ── comments ──
  async addComment(trackId: string, userId: string, body: string): Promise<CommentDto> {
    const exists = await socialRepository.trackExists(trackId);
    if (!exists) throw new NotFoundError('Track');
    const row = await socialRepository.createComment(trackId, userId, body);
    return toCommentDto(row, { likedSet: new Set() });
  },

  async listComments(
    trackId: string,
    cursor: string | undefined,
    limit: number,
    userId?: string,
  ): Promise<CursorPage<CommentDto>> {
    const rows = await socialRepository.comments(trackId, cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    const likedSet = userId
      ? await socialRepository.likedCommentIdSet(
          userId,
          page.items.map((c) => c.id),
        )
      : undefined;
    return { items: page.items.map((c) => toCommentDto(c, { likedSet })), meta: page.meta };
  },

  async deleteComment(commentId: string, userId: string, isModerator: boolean): Promise<void> {
    const comment = await socialRepository.findComment(commentId);
    if (!comment) throw new NotFoundError('Comment');
    if (comment.user.id !== userId && !isModerator) throw new ForbiddenError();
    await socialRepository.deleteComment(commentId);
  },

  async likeComment(commentId: string, userId: string): Promise<void> {
    const comment = await socialRepository.findComment(commentId);
    if (!comment) throw new NotFoundError('Comment');
    await socialRepository.likeComment(commentId, userId);
  },

  async unlikeComment(commentId: string, userId: string): Promise<void> {
    await socialRepository.unlikeComment(commentId, userId);
  },

  // ── feed ──
  async feed(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<FeedEventDto>> {
    const rows = await socialRepository.feed(userId, cursor, limit);
    const page = takePage(rows, limit, (r) => ({ date: r.createdAt, id: r.id }));
    const trackIds = [
      ...new Set(page.items.map((r) => r.trackId).filter((v): v is string => v !== null)),
    ];
    const tracks = await socialRepository.tracksByIds(trackIds);
    const trackById = new Map(tracks.map((t) => [t.id, toTrackDto(t)]));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        type: r.type,
        actor: r.actor,
        track: r.trackId !== null ? (trackById.get(r.trackId) ?? null) : null,
        targetId: r.targetId,
        targetTitle: r.targetTitle,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: page.meta,
    };
  },

  // ── listen sessions ──
  async createSession(hostUserId: string, trackId: string | null): Promise<ListenSessionDto> {
    if (trackId) {
      const exists = await socialRepository.trackExists(trackId);
      if (!exists) throw new NotFoundError('Track');
    }
    const row = await socialRepository.createSession(hostUserId, trackId);
    return this.hydrateSession(row.id);
  },

  async hydrateSession(sessionId: string): Promise<ListenSessionDto> {
    const row = await socialRepository.findSession(sessionId);
    if (!row || row.endedAt !== null) throw new NotFoundError('Listen session');
    let currentTrack = null;
    if (row.trackId) {
      const tracks = await socialRepository.tracksByIds([row.trackId]);
      const track = tracks[0];
      currentTrack = track !== undefined ? toTrackDto(track) : null;
    }
    return toListenSessionDto(row, currentTrack);
  },

  async endSession(sessionId: string, userId: string): Promise<void> {
    const row = await socialRepository.findSession(sessionId);
    if (!row || row.endedAt !== null) throw new NotFoundError('Listen session');
    if (row.hostUserId !== userId) throw new ForbiddenError('Only the host can end a session');
    await socialRepository.endSession(sessionId);
  },
};
