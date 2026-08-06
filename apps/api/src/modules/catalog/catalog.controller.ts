/**
 * Rotas do ACERVO — a listagem que todo mundo lê.
 *
 * LEITURA SEM LOGIN, DE PROPÓSITO: o app funciona para visitante (prévia de
 * 30s), e é o acervo que dá o que ouvir antes de criar conta. Era assim nas
 * regras do Firestore e continua sendo aqui.
 *
 * ESCRITA COM CONTA LOGADA. Mesmo critério que estava nas regras, pelo mesmo
 * motivo: uma comparação de e-mail já negou TODAS as escritas em silêncio (o
 * token de sessão anônima não tem e-mail) e deixou o acervo vazio por dias, sem
 * ninguém conseguir dizer por quê. Aqui a identidade vem do token verificado do
 * Firebase, e o cliente só publica faixas da PRÓPRIA biblioteca.
 */
import { z } from 'zod';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { noContent, ok } from '../../core/http/respond.js';
import { ValidationError } from '../../core/errors/index.js';
import {
  catalogEtag,
  deleteCatalogTrack,
  listCatalog,
  upsertCatalogTrack,
  upsertCatalogTracks,
} from './catalog.repository.js';

/**
 * A faixa chega como o cliente a guarda (`LibraryEntry`) e é gravada inteira.
 *
 * A validação é de FORMA, não de conteúdo: precisa ter `track.id`, e o resto
 * acompanha. Espelhar o tipo do cliente campo a campo aqui só criaria um lugar
 * a mais para desatualizar — e uma faixa recusada por um campo novo some do
 * acervo de todo mundo sem aviso.
 */
const entradaSchema = z
  .object({ track: z.object({ id: z.string().min(1) }).passthrough() })
  .passthrough();

const loteSchema = z.object({
  /** Teto por requisição: a reconciliação de um aparelho novo sobe em blocos. */
  entradas: z.array(entradaSchema).min(1).max(500),
});

function idDa(entrada: unknown): string {
  const parsed = entradaSchema.safeParse(entrada);
  if (!parsed.success) throw new ValidationError('Faixa sem track.id.');
  return parsed.data.track.id;
}

export const catalogController = {
  /**
   * A listagem inteira, com ETag.
   *
   * O 304 é o ponto da rota: o app revalida a cada poucos minutos e, no caso
   * normal (nada mudou), a resposta é um cabeçalho — sem serializar nem
   * trafegar centenas de faixas. É o que torna barato ler daqui em vez do
   * Firestore, onde cada revalidação custava uma leitura POR DOCUMENTO.
   */
  list: asyncHandler(async (req, res) => {
    const etag = await catalogEtag();
    const enviado = req.headers['if-none-match'];
    if (typeof enviado === 'string' && enviado === etag) {
      res.setHeader('ETag', etag);
      res.status(304).end();
      return;
    }
    const snapshot = await listCatalog();
    res.setHeader('ETag', snapshot.etag);
    // Sempre revalidar: o acervo muda quando o admin adiciona faixa, e uma cópia
    // velha em cache intermediário seria indistinguível de "sumiu do acervo".
    res.setHeader('Cache-Control', 'no-cache');
    ok(res, snapshot.entries);
  }),

  upsert: asyncHandler(async (req, res) => {
    const entrada = entradaSchema.parse(req.body);
    await upsertCatalogTrack(idDa(entrada), entrada);
    noContent(res);
  }),

  /** Publica em lote — a reconciliação do cliente sobe o que falta de uma vez. */
  upsertMany: asyncHandler(async (req, res) => {
    const { entradas } = loteSchema.parse(req.body);
    const publicadas = await upsertCatalogTracks(entradas.map((e) => ({ id: idDa(e), data: e })));
    ok(res, { publicadas });
  }),

  remove: asyncHandler(async (req, res) => {
    // `req.params.id` é tipado como `string | string[]`; um array vazio passaria
    // pelo `!id`, então normalizamos antes de checar.
    const id = String(req.params.id ?? '').trim();
    if (!id) throw new ValidationError('Falta o id da faixa.');
    await deleteCatalogTrack(id);
    noContent(res);
  }),
};
