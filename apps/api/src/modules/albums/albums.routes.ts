import { Router } from 'express';
import { cursorQuerySchema, idParamSchema } from '@aurial/shared';
import { validate } from '../../middlewares/validate.js';
import { limitQuerySchema } from '../shared/querySchemas.js';
import { albumsController } from './albums.controller.js';

export const albumsRoutes: Router = Router();

// Static path first so it never collides with /:id.
albumsRoutes.get(
  '/new-releases',
  validate({ query: limitQuerySchema }),
  albumsController.newReleases,
);
albumsRoutes.get('/', validate({ query: cursorQuerySchema }), albumsController.list);
albumsRoutes.get('/:id', validate({ params: idParamSchema }), albumsController.getById);
