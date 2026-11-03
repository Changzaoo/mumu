import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { AppError } from '../../core/errors/index.js';
import { musicaAgora } from './agora.js';
import { radiosService } from './radios.service.js';

export const radiosController = {
  list: asyncHandler(async (req, res) => {
    const { genre } = req.valid.query as { genre?: string };
    ok(res, await radiosService.list(genre));
  }),

  agora: asyncHandler(async (req, res) => {
    const { estacao } = req.valid.params as { estacao: string };
    // Muda a cada música: cache curto e compartilhado na borda.
    res.setHeader('Cache-Control', 'public, max-age=5');
    try {
      ok(res, await musicaAgora(estacao));
    } catch (err) {
      // Radio Browser fora do ar, DNS, timeout: falha do FORNECEDOR, nao da API.
      // Um Error cru caia no ramo final do errorHandler (500 + log com pilha).
      if (err instanceof AppError) throw err;
      throw new AppError('BAD_GATEWAY', 'Radio metadata service unavailable', 502);
    }
  }),

  getById: asyncHandler(async (req, res) => {
    const { id } = req.valid.params as { id: string };
    ok(res, await radiosService.getById(id));
  }),
};
