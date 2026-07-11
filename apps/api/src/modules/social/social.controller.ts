import type { CursorQuery } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { created, noContent, ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import { socialService } from './social.service.js';

const isModerator = (role: string): boolean => role === 'MODERATOR' || role === 'ADMIN';

export const socialController = {
  addComment: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { body } = req.valid.body as { body: string };
    created(res, await socialService.addComment(id, currentUser(req).id, body));
  }),

  listComments: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await socialService.listComments(id, cursor, limit, req.user?.id);
    ok(res, page.items, page.meta);
  }),

  deleteComment: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const user = currentUser(req);
    await socialService.deleteComment(id, user.id, isModerator(user.role));
    noContent(res);
  }),

  likeComment: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await socialService.likeComment(id, currentUser(req).id);
    noContent(res);
  }),

  unlikeComment: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await socialService.unlikeComment(id, currentUser(req).id);
    noContent(res);
  }),

  feed: asyncHandler(async (req, res) => {
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await socialService.feed(currentUser(req).id, cursor, limit);
    ok(res, page.items, page.meta);
  }),

  createSession: asyncHandler(async (req, res) => {
    const { trackId } = req.valid.body as { trackId?: string };
    created(res, await socialService.createSession(currentUser(req).id, trackId ?? null));
  }),

  getSession: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await socialService.hydrateSession(id));
  }),

  endSession: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await socialService.endSession(id, currentUser(req).id);
    noContent(res);
  }),
};
