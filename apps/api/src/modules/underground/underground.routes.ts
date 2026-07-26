import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { undergroundController } from './underground.controller.js';
import {
  undergroundArtistsQuerySchema,
  undergroundSearchQuerySchema,
  undergroundTagQuerySchema,
  undergroundTracksQuerySchema,
  undergroundTrendingQuerySchema,
} from './underground.schemas.js';

export const undergroundRoutes: Router = Router();

undergroundRoutes.get(
  '/artists',
  validate({ query: undergroundArtistsQuerySchema }),
  undergroundController.listArtists,
);
undergroundRoutes.get(
  '/artists/search',
  validate({ query: undergroundSearchQuerySchema }),
  undergroundController.searchArtists,
);
undergroundRoutes.get(
  '/tracks',
  validate({ query: undergroundTracksQuerySchema }),
  undergroundController.listTracks,
);
undergroundRoutes.get(
  '/genres',
  validate({ query: undergroundTagQuerySchema }),
  undergroundController.listGenres,
);
undergroundRoutes.get(
  '/locations',
  validate({ query: undergroundTagQuerySchema }),
  undergroundController.listLocations,
);
undergroundRoutes.get(
  '/trending',
  validate({ query: undergroundTrendingQuerySchema }),
  undergroundController.listTrending,
);
