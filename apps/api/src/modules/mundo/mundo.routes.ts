import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { NotFoundError } from '../../core/errors/index.js';
import { validate } from '../../middlewares/validate.js';
import { agendaDoArtista, avisosPara } from './mundo.repository.js';

/**
 * Montado em /mundo. LEITURA ABERTA, como o acervo: a agenda de um artista é
 * informação pública e o visitante também a vê na ficha. Nada aqui grava o
 * que o cliente manda — a única escrita é a ficha nascer para o worker ler.
 */
export const mundoRoutes: Router = Router();

const nomeSchema = z.object({ nome: z.string().trim().min(1).max(200) });
const avisosSchema = z.object({
  /** Nomes separados por "|" (vírgula faz parte de nome de grupo). */
  artistas: z
    .string()
    .max(4000)
    .transform((s) =>
      s
        .split('|')
        .map((n) => n.trim())
        .filter(Boolean)
        .slice(0, 60),
    ),
});

mundoRoutes.get(
  '/artista/:nome',
  validate({ params: nomeSchema }),
  asyncHandler(async (req, res) => {
    const { nome } = req.valid.params as z.infer<typeof nomeSchema>;
    const agenda = await agendaDoArtista(nome);
    if (!agenda) throw new NotFoundError('Artista');
    // Cache curto: o worker atualiza por hora, e a página revalida sozinha.
    res.setHeader('Cache-Control', 'public, max-age=300');
    ok(res, agenda);
  }),
);

mundoRoutes.get(
  '/avisos',
  validate({ query: avisosSchema }),
  asyncHandler(async (req, res) => {
    const { artistas } = req.valid.query as z.infer<typeof avisosSchema>;
    ok(res, await avisosPara(artistas));
  }),
);
