import type { CursorQuery } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { podcastsService } from './podcasts.service.js';

export const podcastsController = {
  list: asyncHandler(async (req, res) => {
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await podcastsService.list(cursor, limit);
    ok(res, page.items, page.meta);
  }),

  getById: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await podcastsService.getById(id));
  }),

  episodes: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await podcastsService.episodes(id, cursor, limit);
    ok(res, page.items, page.meta);
  }),
};
