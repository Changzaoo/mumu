import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { NotFoundError } from '../../core/errors/index.js';
import { validate } from '../../middlewares/validate.js';
import { agendaDoArtista, avisosPara } from './mundo.repository.js';
import { creditosDaFaixa, fichaTecnicaDoArtista, pessoaCreditada } from './creditos.repository.js';
import { papelDeCreditoSchema } from './creditos.schemas.js';

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

// ── Créditos profundos (worker `creditos`) ───────────────────────────────────

const idSchema = z.object({ id: z.string().trim().min(1).max(200) });
const chaveSchema = z.object({ chave: z.string().trim().min(1).max(120) });
const papelQuerySchema = z.object({ papel: papelDeCreditoSchema.optional() });

/** A ficha de uma faixa: produtor, compositor, gravadora, editora… */
mundoRoutes.get(
  '/faixa/:id/creditos',
  validate({ params: idSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.valid.params as z.infer<typeof idSchema>;
    res.setHeader('Cache-Control', 'public, max-age=300');
    ok(res, await creditosDaFaixa(id));
  }),
);

/** A ficha técnica do artista: contrato/editora/empresário e colaboradores. */
mundoRoutes.get(
  '/artista/:nome/creditos',
  validate({ params: nomeSchema }),
  asyncHandler(async (req, res) => {
    const { nome } = req.valid.params as z.infer<typeof nomeSchema>;
    const ficha = await fichaTecnicaDoArtista(nome);
    if (!ficha) throw new NotFoundError('Artista');
    res.setHeader('Cache-Control', 'public, max-age=300');
    ok(res, ficha);
  }),
);

/** Uma pessoa creditada: o que ela produziu/compôs no acervo. */
mundoRoutes.get(
  '/pessoa/:chave',
  validate({ params: chaveSchema, query: papelQuerySchema }),
  asyncHandler(async (req, res) => {
    const { chave } = req.valid.params as z.infer<typeof chaveSchema>;
    const { papel } = req.valid.query as z.infer<typeof papelQuerySchema>;
    const pessoa = await pessoaCreditada(chave, papel);
    if (!pessoa) throw new NotFoundError('Pessoa');
    res.setHeader('Cache-Control', 'public, max-age=300');
    ok(res, pessoa);
  }),
);
