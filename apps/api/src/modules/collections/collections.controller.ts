/**
 * Rotas das coleções privadas — `/me/colecoes/:nome`.
 *
 * O `userId` vem SEMPRE do token verificado (`currentUser`), nunca da URL ou do
 * corpo. É a única garantia que impede a biblioteca de uma pessoa de aparecer
 * na de outra, e ela não pode depender de o cliente se comportar.
 */
import { z } from 'zod';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { ValidationError } from '../../core/errors/index.js';
import { currentUser } from '../../middlewares/auth.js';
import { listDelta, tombstoneItems, upsertItems } from './collections.repository.js';

/**
 * Coleções que o cliente pode sincronizar.
 *
 * Lista fechada de propósito: sem ela, um cliente adulterado (ou um bug de
 * digitação) criaria coleções novas indefinidamente na tabela de todo mundo.
 */
// 'gosto' guarda UM documento por pessoa (id fixo 'inicial'): os gêneros e
// artistas escolhidos no onboarding. Sem ele na lista, o app perguntaria de
// novo em cada aparelho — ver apps/web/src/lib/local/gostoInicial.ts.
const COLECOES = new Set([
  'library',
  'likes',
  'likedTracks',
  'playlists',
  'playlistTracks',
  'gosto',
]);

function nomeDaColecao(bruto: unknown): string {
  const nome = String(bruto ?? '').trim();
  if (!COLECOES.has(nome)) throw new ValidationError(`Coleção desconhecida: "${nome}".`);
  return nome;
}

const loteSchema = z.object({
  itens: z
    // `data` é o documento do cliente, gravado inteiro e sem inspeção: o formato
    // é dele e muda com ele. `.unknown()` deixaria o campo opcional no tipo —
    // daí o `.default(null)`, que também aceita item sem corpo sem quebrar.
    .array(z.object({ id: z.string().min(1), data: z.unknown().default(null) }))
    .min(1)
    .max(500),
});

const apagarSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

export const collectionsController = {
  /**
   * O que mudou desde o cursor do cliente.
   *
   * Sem `desde`, devolve tudo (primeira sincronia daquele aparelho). Com
   * `desde`, quase sempre devolve lista vazia — que é o caso normal e o motivo
   * de isto existir: o Firestore cobrava a coleção inteira em toda sessão.
   */
  delta: asyncHandler(async (req, res) => {
    const nome = nomeDaColecao(req.params.nome);
    const bruto = req.query.desde;
    const desde = typeof bruto === 'string' && bruto ? new Date(bruto) : null;
    if (desde && Number.isNaN(desde.getTime())) {
      throw new ValidationError('Parâmetro "desde" não é uma data válida.');
    }
    ok(res, await listDelta(currentUser(req).id, nome, desde));
  }),

  upsert: asyncHandler(async (req, res) => {
    const nome = nomeDaColecao(req.params.nome);
    const { itens } = loteSchema.parse(req.body);
    // `unknown` no zod sempre sai opcional no tipo (inclui `undefined`);
    // normalizamos aqui para o repositório receber sempre um valor gravável.
    const gravados = await upsertItems(
      currentUser(req).id,
      nome,
      itens.map((i) => ({ id: i.id, data: i.data ?? null })),
    );
    ok(res, { gravados });
  }),

  /**
   * Apagar em lote, por corpo e não por URL.
   *
   * A fila offline do cliente acumula remoções enquanto o servidor está fora do
   * ar; mandar uma requisição por item ao voltar seria uma rajada logo no pior
   * momento — quando o servidor acabou de subir.
   */
  remove: asyncHandler(async (req, res) => {
    const nome = nomeDaColecao(req.params.nome);
    const { ids } = apagarSchema.parse(req.body);
    const apagados = await tombstoneItems(currentUser(req).id, nome, ids);
    ok(res, { apagados });
  }),
};
