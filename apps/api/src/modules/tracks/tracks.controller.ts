import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { currentUser } from '../../middlewares/auth.js';
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

  download: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { stream, contentType, fileName, sizeBytes } = await tracksService.getDownload(
      currentUser(req).id,
      id,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, max-age=0');
    if (sizeBytes !== null) res.setHeader('Content-Length', String(sizeBytes));
    stream.on('error', () => {
      if (!res.headersSent) res.status(500);
      res.destroy();
    });
    stream.pipe(res);
  }),
};
