/**
 * Telemetria de uso — `/telemetria`.
 *
 * A ESCRITA É ABERTA, e isso é o ponto da mudança inteira. A telemetria antiga
 * exigia login, então quem não tinha conta não aparecia em lugar nenhum do
 * painel — e visitante é justamente quem mais interessa entender, porque ainda
 * não decidiu ficar. Exigir conta para contar visitante é uma contradição.
 *
 * Aberto não quer dizer sem defesa: o corpo tem teto de tamanho, o id do
 * aparelho tem formato validado, e o limite de requisições do app já se aplica.
 * O pior que um abusador consegue é sujar a própria linha.
 *
 * A LEITURA continua restrita — é painel de administração.
 */
import { z } from 'zod';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { ValidationError } from '../../core/errors/index.js';
import { listar, mesclar } from './telemetry.repository.js';

/**
 * O id do aparelho é gerado no cliente, então o formato é a única coisa que dá
 * para exigir: sem isso, um id de 10 KB (ou com caractere de controle) viraria
 * chave primária na tabela.
 */
const deviceIdSchema = z
  .string()
  .trim()
  .min(6)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'id de aparelho inválido');

const corpoSchema = z.object({
  // O documento é do cliente e muda com ele — gravado sem inspeção de campo,
  // como já se faz nas coleções. O que se controla aqui é o TAMANHO.
  dados: z.record(z.string(), z.unknown()),
});

export const telemetryController = {
  /** Funde um pedaço de telemetria no documento do aparelho. Sem login. */
  registrar: asyncHandler(async (req, res) => {
    const deviceId = deviceIdSchema.parse(req.params.deviceId);
    const { dados } = corpoSchema.parse(req.body);

    // Lê `req.user` DIRETO em vez de `currentUser(req)`, que estoura sem conta.
    // O middleware `authenticate` já preenche o campo quando vem um token
    // válido e segue em frente quando não vem — que é exatamente o que esta
    // rota precisa: identifica quem está logado, aceita quem não está.
    const userId = req.user?.id ?? null;

    const resultado = await mesclar(deviceId, userId, dados);
    if (resultado === 'grande-demais') {
      throw new ValidationError('Telemetria grande demais para este aparelho.');
    }
    res.status(204).end();
  }),

  /** O painel. Restrito — a rota monta `requireAuth` na frente. */
  listar: asyncHandler(async (req, res) => {
    const limite = Number(req.query.limite ?? 200);
    ok(res, await listar(Number.isFinite(limite) ? limite : 200));
  }),
};
