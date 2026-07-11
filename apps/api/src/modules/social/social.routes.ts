import { Router } from 'express';
import { z } from 'zod';
import { createCommentSchema, cursorQuerySchema, idParamSchema, idSchema } from '@aurial/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { socialController } from './social.controller.js';

const createSessionSchema = z.object({ trackId: idSchema.optional() });

/** Mounted at the API root: /feed, /tracks/:id/comments, /comments/:id, /sessions. */
export const socialRoutes: Router = Router();

socialRoutes.get(
  '/feed',
  requireAuth,
  validate({ query: cursorQuerySchema }),
  socialController.feed,
);

socialRoutes.post(
  '/tracks/:id/comments',
  requireAuth,
  validate({ params: idParamSchema, body: createCommentSchema }),
  socialController.addComment,
);
socialRoutes.get(
  '/tracks/:id/comments',
  validate({ params: idParamSchema, query: cursorQuerySchema }),
  socialController.listComments,
);
socialRoutes.delete(
  '/comments/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  socialController.deleteComment,
);
socialRoutes.put(
  '/comments/:id/like',
  requireAuth,
  validate({ params: idParamSchema }),
  socialController.likeComment,
);
socialRoutes.delete(
  '/comments/:id/like',
  requireAuth,
  validate({ params: idParamSchema }),
  socialController.unlikeComment,
);

socialRoutes.post(
  '/sessions',
  requireAuth,
  validate({ body: createSessionSchema }),
  socialController.createSession,
);
socialRoutes.get(
  '/sessions/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  socialController.getSession,
);
socialRoutes.delete(
  '/sessions/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  socialController.endSession,
);
