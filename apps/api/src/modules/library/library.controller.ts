import type { CursorQuery } from '@aurial/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { noContent, ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
import { libraryService } from './library.service.js';

export const libraryController = {
  getLibrary: asyncHandler(async (req, res) => {
    ok(res, await libraryService.getLibrary(currentUser(req).id));
  }),

  likedTracks: asyncHandler(async (req, res) => {
    const { cursor, limit } = req.valid.query as CursorQuery;
    const page = await libraryService.likedTracks(currentUser(req).id, cursor, limit);
    ok(res, page.items, page.meta);
  }),

  likeTrack: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await libraryService.likeTrack(currentUser(req).id, id);
    noContent(res);
  }),

  unlikeTrack: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await libraryService.unlikeTrack(currentUser(req).id, id);
    noContent(res);
  }),

  likeAlbum: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await libraryService.likeAlbum(currentUser(req).id, id);
    noContent(res);
  }),

  unlikeAlbum: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await libraryService.unlikeAlbum(currentUser(req).id, id);
    noContent(res);
  }),

  followArtist: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await libraryService.followArtist(currentUser(req).id, id);
    noContent(res);
  }),

  unfollowArtist: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await libraryService.unfollowArtist(currentUser(req).id, id);
    noContent(res);
  }),
};
