import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { radiosService } from './radios.service.js';

export const radiosController = {
  list: asyncHandler(async (req, res) => {
    const { genre } = req.valid.query as { genre?: string };
    ok(res, await radiosService.list(genre));
  }),

  getById: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await radiosService.getById(id));
  }),
};
