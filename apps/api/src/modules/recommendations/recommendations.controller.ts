import type { Mood } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import { recommendationsService } from './recommendations.service.js';

export const recommendationsController = {
  dailyMix: asyncHandler(async (req, res) => {
    ok(res, await recommendationsService.dailyMix(currentUser(req).id));
  }),

  discover: asyncHandler(async (req, res) => {
    ok(res, await recommendationsService.discover(currentUser(req).id));
  }),

  byMood: asyncHandler(async (req, res) => {
    const { mood } = req.valid.params as { mood: Mood };
    ok(res, await recommendationsService.byMood(mood, req.user?.id));
  }),

  trackRadio: asyncHandler(async (req, res) => {
    const { trackId } = req.valid.params as { trackId: string };
    ok(res, await recommendationsService.trackRadio(trackId, req.user?.id));
  }),
};
