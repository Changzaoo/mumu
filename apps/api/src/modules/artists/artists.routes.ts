import { Router } from 'express';
import { cursorQuerySchema, idParamSchema } from '@aurial/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { limitQuerySchema } from '../shared/querySchemas.js';
import { artistsController } from './artists.controller.js';

export const artistsRoutes: Router = Router();

artistsRoutes.get('/', validate({ query: cursorQuerySchema }), artistsController.list);
artistsRoutes.get('/:id', validate({ params: idParamSchema }), artistsController.getById);
artistsRoutes.get(
  '/:id/top-tracks',
  validate({ params: idParamSchema, query: limitQuerySchema }),
  artistsController.topTracks,
);
artistsRoutes.get(
  '/:id/albums',
  validate({ params: idParamSchema, query: cursorQuerySchema }),
  artistsController.albums,
);
artistsRoutes.get(
  '/:id/related',
  validate({ params: idParamSchema, query: limitQuerySchema }),
  artistsController.related,
);
artistsRoutes.post(
  '/:id/follow',
  requireAuth,
  validate({ params: idParamSchema }),
  artistsController.follow,
);
artistsRoutes.delete(
  '/:id/follow',
  requireAuth,
  validate({ params: idParamSchema }),
  artistsController.unfollow,
);
