import { Router } from 'express';
import { cursorQuerySchema, idParamSchema } from '@aurial/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { libraryController } from './library.controller.js';

/** Mounted at /me/library. */
export const libraryRoutes: Router = Router();

libraryRoutes.use(requireAuth);

libraryRoutes.get('/', libraryController.getLibrary);
libraryRoutes.get(
  '/liked-tracks',
  validate({ query: cursorQuerySchema }),
  libraryController.likedTracks,
);

libraryRoutes.put('/tracks/:id', validate({ params: idParamSchema }), libraryController.likeTrack);
libraryRoutes.delete(
  '/tracks/:id',
  validate({ params: idParamSchema }),
  libraryController.unlikeTrack,
);

libraryRoutes.put('/albums/:id', validate({ params: idParamSchema }), libraryController.likeAlbum);
libraryRoutes.delete(
  '/albums/:id',
  validate({ params: idParamSchema }),
  libraryController.unlikeAlbum,
);

libraryRoutes.put(
  '/artists/:id',
  validate({ params: idParamSchema }),
  libraryController.followArtist,
);
libraryRoutes.delete(
  '/artists/:id',
  validate({ params: idParamSchema }),
  libraryController.unfollowArtist,
);
