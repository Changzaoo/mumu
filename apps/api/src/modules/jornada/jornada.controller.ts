/**
 * Jornada — `/jornada`.
 *
 * `me` exige conta. O convite é ABERTO (quem abre o link ainda não tem conta),
 * com coleira própria; o pior que um abusador faz é inflar a contagem de amigos
 * de um padrinho com aparelhos inventados, e cada um custa uma linha pequena.
 */
import type { AtualizarJornadaInput, ConviteBody } from '@radinho/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { AppError, NotFoundError } from '../../core/errors/index.js';
import { currentUser } from '../../middlewares/auth.js';
import { atualizar, obter, obterConvite, registrarConvite } from './jornada.repository.js';

export const jornadaController = {
  me: asyncHandler(async (req, res) => {
    ok(res, await obter(currentUser(req).id));
  }),

  atualizar: asyncHandler(async (req, res) => {
    const body = req.valid.body as AtualizarJornadaInput;
    ok(res, await atualizar(currentUser(req).id, body));
  }),

  convite: asyncHandler(async (req, res) => {
    const { padrinho, deviceId } = req.valid.body as ConviteBody;
    const r = await registrarConvite(padrinho, deviceId, req.user?.id ?? null);
    if (r === 'padrinho-inexistente') throw new NotFoundError('Padrinho');
    if (r === 'proprio-padrinho') {
      throw new AppError('BAD_REQUEST', 'Não dá para convidar a si mesmo', 400);
    }
    ok(res, { ok: true, novo: r === 'novo' });
  }),

  verConvite: asyncHandler(async (req, res) => {
    const convite = await obterConvite(String(req.params.handle));
    if (!convite) throw new NotFoundError('Padrinho');
    ok(res, convite);
  }),
};
