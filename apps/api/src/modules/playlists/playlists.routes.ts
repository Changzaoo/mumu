import { Router } from 'express';
import {
  addCollaboratorSchema,
  addPlaylistTracksSchema,
  createPlaylistSchema,
  cursorQuerySchema,
  idParamSchema,
  removePlaylistTracksSchema,
  reorderPlaylistSchema,
  updatePlaylistSchema,
} from '@aurial/shared';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { playlistsController } from './playlists.controller.js';

export const playlistsRoutes: Router = Router();

playlistsRoutes.get(
  '/',
  requireAuth,
  validate({ query: cursorQuerySchema }),
  playlistsController.listMine,
);
playlistsRoutes.post(
  '/',
  requireAuth,
  validate({ body: createPlaylistSchema }),
  playlistsController.create,
);
playlistsRoutes.get('/:id', validate({ params: idParamSchema }), playlistsController.getById);
playlistsRoutes.patch(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema, body: updatePlaylistSchema }),
  playlistsController.update,
);
playlistsRoutes.delete(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  playlistsController.delete,
);

playlistsRoutes.post(
  '/:id/tracks',
  requireAuth,
  validate({ params: idParamSchema, body: addPlaylistTracksSchema }),
  playlistsController.addTracks,
);
playlistsRoutes.delete(
  '/:id/tracks',
  requireAuth,
  validate({ params: idParamSchema, body: removePlaylistTracksSchema }),
  playlistsController.removeTracks,
);
playlistsRoutes.patch(
  '/:id/tracks/reorder',
  requireAuth,
  validate({ params: idParamSchema, body: reorderPlaylistSchema }),
  playlistsController.reorder,
);
playlistsRoutes.post(
  '/:id/collaborators',
  requireAuth,
  validate({ params: idParamSchema, body: addCollaboratorSchema }),
  playlistsController.addCollaborator,
);
