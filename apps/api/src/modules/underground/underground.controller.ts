import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import type {
  UndergroundArtistsQuery,
  UndergroundSearchQuery,
  UndergroundTagQuery,
  UndergroundTracksQuery,
  UndergroundTrendingQuery,
} from './underground.schemas.js';
import { undergroundService } from './underground.service.js';

export const undergroundController = {
  listArtists: asyncHandler(async (req, res) => {
    const { cursor, limit, catalogTag, minListeners, maxListeners } = req.valid
      .query as UndergroundArtistsQuery;
    const page = await undergroundService.listArtists(cursor, limit, {
      catalogTag,
      minListeners,
      maxListeners,
    });
    ok(res, page.items, page.meta);
  }),

  searchArtists: asyncHandler(async (req, res) => {
    const { q, limit, catalogTag, location } = req.valid.query as UndergroundSearchQuery;
    ok(res, await undergroundService.searchArtists(q, limit, { catalogTag, location }));
  }),

  listTracks: asyncHandler(async (req, res) => {
    const { cursor, limit, catalogTag, genre } = req.valid.query as UndergroundTracksQuery;
    const page = await undergroundService.listTracks(cursor, limit, { catalogTag, genre });
    ok(res, page.items, page.meta);
  }),

  listGenres: asyncHandler(async (req, res) => {
    const { catalogTag } = req.valid.query as UndergroundTagQuery;
    ok(res, await undergroundService.listGenres(catalogTag));
  }),

  listLocations: asyncHandler(async (req, res) => {
    const { catalogTag } = req.valid.query as UndergroundTagQuery;
    ok(res, await undergroundService.listLocations(catalogTag));
  }),

  listTrending: asyncHandler(async (req, res) => {
    const { limit, catalogTag, days } = req.valid.query as UndergroundTrendingQuery;
    ok(res, await undergroundService.listTrendingTracks(limit, catalogTag, days));
  }),
};
