import type { SearchQuery } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { searchService } from './search.service.js';

export const searchController = {
  search: asyncHandler(async (req, res) => {
    const query = req.valid.query as SearchQuery;
    ok(res, await searchService.search(query, req.user?.id));
  }),

  suggest: asyncHandler(async (req, res) => {
    const { q } = req.valid.query as { q: string };
    ok(res, await searchService.suggest(q));
  }),
};
