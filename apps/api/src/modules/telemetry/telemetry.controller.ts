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
import type { Request } from 'express';
import { ehRobo } from '@radinho/shared';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ok } from '../../core/http/respond.js';
import { ValidationError } from '../../core/errors/index.js';
import {
  listar,
  mesclar,
  profundidadeAceitavel,
  tamanhoAceitavel,
  MAX_PROFUNDIDADE,
} from './telemetry.repository.js';

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
  // como já se faz nas coleções. O que se controla aqui é a FORMA: tamanho e
  // profundidade, as duas coisas que não dependem de saber o que os campos são.
  dados: z.record(z.string(), z.unknown()),
});

/**
 * A PORTA, e ela fica ANTES do banco.
 *
 * O teto de tamanho existia só no documento JÁ FUNDIDO, dentro do repositório —
 * ou seja, depois de um `SELECT` no Postgres. Quem quisesse gastar o banco de
 * graça mandava 1 MB (o limite do `express.json`) por requisição e cada uma
 * custava uma ida ao Postgres antes de ser recusada.
 *
 * Pior: com aninhamento fundo a recusa nem chegava a acontecer. O `JSON.stringify`
 * que MEDE o tamanho estoura a pilha em ~5.000 níveis, então o corpo que deveria
 * ser barrado pelo teto derrubava a própria medição — 500 em vez de 4xx, a 10 KB
 * por tentativa, sem conta nenhuma. Ver `MAX_PROFUNDIDADE`.
 *
 * A ordem aqui é obrigatória: profundidade PRIMEIRO (checagem iterativa, não
 * estoura), tamanho depois (precisa do `stringify`, que estouraria).
 */
function recusarPedacoAbusivo(dados: Record<string, unknown>): void {
  if (!profundidadeAceitavel(dados)) {
    throw new ValidationError(`Telemetria aninhada demais (máximo de ${MAX_PROFUNDIDADE} níveis).`);
  }
  if (!tamanhoAceitavel(JSON.stringify(dados))) {
    throw new ValidationError('Telemetria grande demais para este aparelho.');
  }
}

/**
 * QUEM NÃO É O APP NÃO VIRA LINHA.
 *
 * Aberto para visitante não quer dizer aberto para robô: cada página que o
 * Googlebot renderizava chegava com um `deviceId` novo e virava um "Usuário ·
 * Outro · Chrome" no painel — centenas deles, empurrando as contas de verdade
 * para fora da listagem.
 *
 * Duas portas:
 *  - user-agent de robô / automação (regra única em `@radinho/shared`);
 *  - pedido SEM `Origin`. O app sempre manda: é um PUT de outra origem (ou do
 *    WebView do app), e navegador põe `Origin` em todo método que não é GET.
 *    Quem não manda é script — curl, cron, um processo do próprio servidor.
 *
 *  - visitante SEM conta desenhando com SwiftShader — a GPU por software do
 *    Chrome sem cabeça. Medido na produção (2026-10-16): 6.177 dos ~6.200
 *    aparelhos-robô tinham essa GPU, inclusive os que se diziam "Windows"; das
 *    14 contas, nenhuma. Com conta, grava mesmo assim: gente real também cai
 *    nessa GPU (PC sem aceleração, máquina virtual), e conta é prova de gente.
 *
 * A resposta continua 204: o robô não tem por que tentar de novo, e ninguém
 * ganha nada sabendo que foi ignorado.
 */
function deveIgnorar(req: Request, dados: Record<string, unknown>): boolean {
  if (ehRobo(req.get('user-agent'))) return true;
  if (!req.get('origin')) return true;
  const gpu = typeof dados.gpu === 'string' ? dados.gpu : '';
  return !req.user && /swiftshader/i.test(gpu);
}

export const telemetryController = {
  /** Funde um pedaço de telemetria no documento do aparelho. Sem login. */
  registrar: asyncHandler(async (req, res) => {
    const deviceId = deviceIdSchema.parse(req.params.deviceId);
    const { dados } = corpoSchema.parse(req.body);
    recusarPedacoAbusivo(dados);
    // Depois da validação (que não custa banco e mantém o 422 de sempre para
    // entrada malformada), antes de qualquer leitura no Postgres.
    if (deveIgnorar(req, dados)) {
      res.status(204).end();
      return;
    }

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
