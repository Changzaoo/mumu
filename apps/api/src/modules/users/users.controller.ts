import type { CursorQuery, UpdateMeInput } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { noContent, ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import { usersService } from './users.service.js';

export const usersController = {
  getMe: asyncHandler(async (req, res) => {
    ok(res, await usersService.getMe(currentUser(req).id));
  }),

  updateMe: asyncHandler(async (req, res) => {
    const body = req.valid.body as UpdateMeInput;
    ok(res, await usersService.updateMe(currentUser(req).id, body));
  }),

  getMyStats: asyncHandler(async (req, res) => {
    ok(res, await usersService.getStats(currentUser(req).id));
  }),

  getUser: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await usersService.getUser(id, req.user?.id));
  }),

  getUserPlaylists: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await usersService.getUserPlaylists(id, cursor, limit);
    ok(res, page.items, page.meta);
  }),

  follow: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await usersService.follow(currentUser(req).id, id);
    noContent(res);
  }),

  unfollow: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await usersService.unfollow(currentUser(req).id, id);
    noContent(res);
  }),
};
