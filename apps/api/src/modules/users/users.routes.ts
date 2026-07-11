import { Router } from 'express';
import { cursorQuerySchema, idParamSchema, updateMeSchema } from '@aurial/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { usersController } from './users.controller.js';

export const usersRoutes: Router = Router();

usersRoutes.get('/me', requireAuth, usersController.getMe);
usersRoutes.patch('/me', requireAuth, validate({ body: updateMeSchema }), usersController.updateMe);
usersRoutes.get('/me/stats', requireAuth, usersController.getMyStats);

usersRoutes.get('/users/:id', validate({ params: idParamSchema }), usersController.getUser);
usersRoutes.get(
  '/users/:id/playlists',
  validate({ params: idParamSchema, query: cursorQuerySchema }),
  usersController.getUserPlaylists,
);
usersRoutes.post(
  '/users/:id/follow',
  requireAuth,
  validate({ params: idParamSchema }),
  usersController.follow,
);
usersRoutes.delete(
  '/users/:id/follow',
  requireAuth,
  validate({ params: idParamSchema }),
  usersController.unfollow,
);
