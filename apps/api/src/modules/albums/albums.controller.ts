import type { CursorQuery } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import type { LimitQuery } from '../shared/querySchemas.js';
import { albumsService } from './albums.service.js';

export const albumsController = {
  list: asyncHandler(async (req, res) => {
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await albumsService.list(cursor, limit);
    ok(res, page.items, page.meta);
  }),

  getById: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await albumsService.getById(id, req.user?.id));
  }),

  newReleases: asyncHandler(async (req, res) => {
    const { limit } = req.valid.query as LimitQuery;
    ok(res, await albumsService.newReleases(limit));
  }),
};
