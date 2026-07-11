import { asyncHandler } from '../../core/http/asyncHandler.js';
import { noContent, ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import { authService } from './auth.service.js';

export const authController = {
  createSession: asyncHandler(async (req, res) => {
    ok(res, await authService.createSession(currentUser(req).id));
  }),

  deleteSession: asyncHandler(async (req, res) => {
    await authService.endSession(currentUser(req).id);
    noContent(res);
  }),
};
