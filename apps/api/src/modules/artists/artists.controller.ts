import type { CursorQuery } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { noContent, ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import type { LimitQuery } from '../shared/querySchemas.js';
import { artistsService } from './artists.service.js';

export const artistsController = {
  list: asyncHandler(async (req, res) => {
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await artistsService.list(cursor, limit);
    ok(res, page.items, page.meta);
  }),

  getById: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await artistsService.getById(id, req.user?.id));
  }),

  topTracks: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { limit } = req.valid.query as LimitQuery;
    ok(res, await artistsService.topTracks(id, limit, req.user?.id));
  }),

  albums: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await artistsService.albums(id, cursor, limit);
    ok(res, page.items, page.meta);
  }),

  related: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { limit } = req.valid.query as LimitQuery;
    ok(res, await artistsService.related(id, limit));
  }),

  follow: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await artistsService.follow(currentUser(req).id, id);
    noContent(res);
  }),

  unfollow: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await artistsService.unfollow(currentUser(req).id, id);
    noContent(res);
  }),
};
