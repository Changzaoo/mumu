import type {
  AddPlaylistTracksInput,
  CreatePlaylistInput,
  CursorQuery,
  ReorderPlaylistInput,
  UpdatePlaylistInput,
} from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { created, noContent, ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import { playlistsService } from './playlists.service.js';

export const playlistsController = {
  listMine: asyncHandler(async (req, res) => {
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await playlistsService.listMine(currentUser(req).id, cursor, limit);
    ok(res, page.items, page.meta);
  }),

  create: asyncHandler(async (req, res) => {
    const body = req.valid.body as CreatePlaylistInput;
    created(res, await playlistsService.create(currentUser(req).id, body));
  }),

  getById: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await playlistsService.getById(id, req.user?.id));
  }),

  update: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const body = req.valid.body as UpdatePlaylistInput;
    ok(res, await playlistsService.update(id, currentUser(req).id, body));
  }),

  delete: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await playlistsService.delete(id, currentUser(req).id);
    noContent(res);
  }),

  addTracks: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const body = req.valid.body as AddPlaylistTracksInput;
    ok(res, await playlistsService.addTracks(id, currentUser(req).id, body));
  }),

  removeTracks: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { entryIds } = req.valid.body as { entryIds: string[] };
    ok(res, await playlistsService.removeTracks(id, currentUser(req).id, entryIds));
  }),

  reorder: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const body = req.valid.body as ReorderPlaylistInput;
    ok(res, await playlistsService.reorder(id, currentUser(req).id, body));
  }),

  addCollaborator: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { userId } = req.valid.body as { userId: string };
    await playlistsService.addCollaborator(id, currentUser(req).id, userId);
    noContent(res);
  }),
};
