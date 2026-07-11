import { Router } from 'express';
import { z } from 'zod';
import { idSchema, moodSchema } from '@aurial/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { recommendationsController } from './recommendations.controller.js';

/** Mounted at /recs. */
export const recommendationsRoutes: Router = Router();

recommendationsRoutes.get('/daily-mix', requireAuth, recommendationsController.dailyMix);
recommendationsRoutes.get('/discover', requireAuth, recommendationsController.discover);
recommendationsRoutes.get(
  '/mood/:mood',
  validate({ params: z.object({ mood: moodSchema }) }),
  recommendationsController.byMood,
);
recommendationsRoutes.get(
  '/track-radio/:trackId',
  validate({ params: z.object({ trackId: idSchema }) }),
  recommendationsController.trackRadio,
);
