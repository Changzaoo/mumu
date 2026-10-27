import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { lerEmAlta } from './emAlta.repository.js';

/** Montado em /em-alta. */
export const emAltaRoutes: Router = Router();

// Leitura ABERTA, como o acervo: a parada é pública e é a mesma para todo
// mundo — quem aplica idade e gosto é o aparelho. O worker grava de hora em
// hora; a resposta pode viver em cache uns minutos sem ninguém notar.
emAltaRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const dto = await lerEmAlta();
    const genero = typeof req.query.genero === 'string' ? req.query.genero.trim() : '';
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (!dto) {
      ok(res, null);
      return;
    }
    ok(res, genero ? { ...dto, generos: dto.generos.filter((g) => g.genero === genero) } : dto);
  }),
);
