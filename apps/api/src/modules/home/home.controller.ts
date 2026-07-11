import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import { homeService } from './home.service.js';

export const homeController = {
  getHome: asyncHandler(async (req, res) => {
    ok(res, await homeService.getHome(currentUser(req).id));
  }),
};
