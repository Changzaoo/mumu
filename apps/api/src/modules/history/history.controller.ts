import type { CursorQuery, RecordPlayInput } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { created, ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import type { LimitQuery } from '../shared/querySchemas.js';
import { historyService } from './history.service.js';

export const historyController = {
  record: asyncHandler(async (req, res) => {
    const body = req.valid.body as RecordPlayInput;
    created(res, await historyService.record(currentUser(req).id, body));
  }),

  list: asyncHandler(async (req, res) => {
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await historyService.list(currentUser(req).id, cursor, limit);
    ok(res, page.items, page.meta);
  }),

  recent: asyncHandler(async (req, res) => {
    const { limit } = req.valid.query as LimitQuery;
    ok(res, await historyService.recent(currentUser(req).id, limit));
  }),

  clear: asyncHandler(async (req, res) => {
    ok(res, await historyService.clear(currentUser(req).id));
  }),
};
