import { Router } from 'express';
import { idParamSchema } from '@aurial/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { tracksController } from './tracks.controller.js';

export const tracksRoutes: Router = Router();

tracksRoutes.get('/:id', validate({ params: idParamSchema }), tracksController.getById);
tracksRoutes.get(
  '/:id/waveform',
  validate({ params: idParamSchema }),
  tracksController.getWaveform,
);
tracksRoutes.get('/:id/lyrics', validate({ params: idParamSchema }), tracksController.getLyrics);
tracksRoutes.get(
  '/:id/download',
  requireAuth,
  validate({ params: idParamSchema }),
  tracksController.download,
);
