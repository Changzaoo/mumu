import { Router } from 'express';
import { cursorQuerySchema, idParamSchema } from '@aurial/shared';
import { validate } from '../../middlewares/validate.js';
import { podcastsController } from './podcasts.controller.js';

export const podcastsRoutes: Router = Router();

podcastsRoutes.get('/', validate({ query: cursorQuerySchema }), podcastsController.list);
podcastsRoutes.get('/:id', validate({ params: idParamSchema }), podcastsController.getById);
podcastsRoutes.get(
  '/:id/episodes',
  validate({ params: idParamSchema, query: cursorQuerySchema }),
  podcastsController.episodes,
);
