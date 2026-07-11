import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { tracksService } from './tracks.service.js';

export const tracksController = {
  getById: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await tracksService.getById(id, req.user?.id));
  }),

  getWaveform: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await tracksService.getWaveform(id));
  }),

  getLyrics: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await tracksService.getLyrics(id));
  }),
};
