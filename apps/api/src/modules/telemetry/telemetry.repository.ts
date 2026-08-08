/**
 * Telemetria por aparelho — leitura e escrita.
 *
 * A escrita é uma FUSÃO rasa: o cliente manda pedaços (tempo de tela agora, top
 * de faixas depois, rede quando mede) e cada um substitui só a sua chave. Era o
 * `{ merge: true }` do Firestore; aqui é explícito.
 */
import { prisma } from '../../infra/db/prisma.js';

/** Teto do documento por aparelho. Ver o comentário em `mesclar`. */
export const MAX_BYTES = 64 * 1024;

/**
 * TETO DE ANINHAMENTO — o corpo aberto conseguia derrubar a requisição em 10 KB.
 *
 * `JSON.stringify` desce recursivamente, e o endereço de escrita é público. Um
 * corpo de dez mil bytes — `{"dados":{"a":[[[[…5.000 níveis…]]]]}}` — estoura a
 * pilha do Node com `RangeError: Maximum call stack size exceeded`. Medido: 5.000
 * níveis de array bastam, e o limite de 1 MB do `express.json` deixa passar
 * cento e setenta mil. O `fundir` cai antes ainda, por volta de 4.000 níveis de
 * objeto, e cai de forma NÃO DETERMINÍSTICA (depende de quanta pilha já estava
 * em uso) — o que é pior que cair sempre: o mesmo corpo às vezes grava e às
 * vezes devolve 500.
 *
 * Pior: a explosão acontecia DEPOIS do `findUnique`, então cada requisição
 * abusiva ainda custava uma ida ao Postgres antes de morrer.
 *
 * Telemetria de verdade tem três níveis (`pageSeconds.inicio`, `clickCounts.tocar`).
 * Dezesseis é folga larga para o cliente crescer e ainda assim uma parede.
 */
export const MAX_PROFUNDIDADE = 16;

/**
 * Chaves que NÃO atravessam a fusão.
 *
 * `__proto__` não polui o `Object.prototype` global aqui (medido: a atribuição
 * cai no acessor e troca o protótipo do objeto local, não o de todo mundo) — mas
 * o efeito real é igualmente ruim de um jeito silencioso: a chave some do
 * documento gravado, e o objeto entregue ao Prisma sai com o protótipo trocado.
 * Escrita aceita com 204 e dado que não existe é o pior par possível.
 */
const CHAVES_PROIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * O pedaço que chegou é raso o bastante para ser processado com segurança?
 *
 * Iterativo DE PROPÓSITO: uma checagem recursiva de profundidade estouraria a
 * pilha exatamente no corpo que ela existe para barrar.
 */
export function profundidadeAceitavel(raiz: unknown, max = MAX_PROFUNDIDADE): boolean {
  const pilha: Array<{ valor: unknown; nivel: number }> = [{ valor: raiz, nivel: 1 }];
  while (pilha.length > 0) {
    const { valor, nivel } = pilha.pop()!;
    if (typeof valor !== 'object' || valor === null) continue;
    if (nivel > max) return false;
    // Arrays contam: quem derruba o `JSON.stringify` mais barato são eles,
    // porque o `fundir` nem desce neles e o teto de tamanho vem depois.
    const filhos = Array.isArray(valor) ? valor : Object.values(valor);
    for (const filho of filhos) pilha.push({ valor: filho, nivel: nivel + 1 });
  }
  return true;
}

/**
 * Tamanho em BYTES, não em unidades de UTF-16.
 *
 * `JSON.stringify(x).length` conta unidades de UTF-16, e o Postgres guarda
 * UTF-8: um documento de sessenta mil caracteres em japonês (ou em emoji) mede
 * 60.008 pelo `.length` e ocupa 180.008 bytes no banco. O teto de 64 KB deixava
 * passar o TRIPLO do que prometia — e num endereço de escrita aberto essa
 * diferença é exatamente o que um abusador procura.
 */
export function tamanhoAceitavel(texto: string, max = MAX_BYTES): boolean {
  return Buffer.byteLength(texto, 'utf8') <= max;
}

/**
 * "Some ao que já existe" — o `increment` do Firestore, agora explícito.
 *
 * A telemetria é feita de acumulados: segundos com o app aberto, cliques por
 * botão, erros, sessões. O cliente mede um PEDAÇO (os 30s desde o último envio)
 * e não sabe o total — quem sabe é quem guarda. No Firestore isso era
 * `increment(n)`; numa fusão de JSON crua o pedaço SUBSTITUIRIA o acumulado, e
 * o painel mostraria "30 segundos de uso" para quem passou horas no app.
 *
 * O cliente marca esses campos com `{ __inc: n }` e a soma acontece aqui.
 */
interface Incremento {
  __inc: number;
}

function ehIncremento(v: unknown): v is Incremento {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Incremento).__inc === 'number' &&
    Number.isFinite((v as Incremento).__inc)
  );
}

const ehObjetoSimples = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Funde `pedaco` sobre `base`, somando o que vier marcado como incremento. */
export function fundirParaTeste(
  base: Record<string, unknown>,
  pedaco: Record<string, unknown>,
): Record<string, unknown> {
  return fundir(base, pedaco);
}

function fundir(
  base: Record<string, unknown>,
  pedaco: Record<string, unknown>,
): Record<string, unknown> {
  const saida: Record<string, unknown> = { ...base };
  for (const [chave, valor] of Object.entries(pedaco)) {
    // Ver `CHAVES_PROIBIDAS`: aceitar e não gravar é pior que recusar.
    if (CHAVES_PROIBIDAS.has(chave)) continue;
    if (ehIncremento(valor)) {
      const atual = saida[chave];
      saida[chave] = (typeof atual === 'number' ? atual : 0) + valor.__inc;
      continue;
    }
    // Mapas aninhados (cliques por botão, segundos por página) trazem
    // incrementos DENTRO deles — descer é o que faz cada contador somar em vez
    // de o mapa inteiro ser trocado pelo pedaço da última janela.
    //
    // DESCE MESMO QUANDO O MAPA É NOVO. Antes o ramo exigia que a base já
    // tivesse a chave, e o primeiro envio de um aparelho gravava a MARCA crua
    // (`{"inicio":{"__inc":12}}`) no banco. A partir daí o campo era um objeto
    // para sempre: as fusões seguintes somavam dentro dele, o painel exibia
    // "[object Object]", e nada no caminho reclamava.
    if (ehObjetoSimples(valor)) {
      const base = ehObjetoSimples(saida[chave]) ? (saida[chave] as Record<string, unknown>) : {};
      saida[chave] = fundir(base, valor);
      continue;
    }
    saida[chave] = valor;
  }
  return saida;
}

export interface TelemetryRow {
  deviceId: string;
  userId: string | null;
  data: Record<string, unknown>;
  updatedAt: Date;
}

/**
 * Funde o pedaço novo no documento do aparelho.
 *
 * O TETO NÃO É PARANOIA. O endereço de escrita é PÚBLICO por necessidade — um
 * visitante não tem conta para autenticar, e é justamente ele que precisamos
 * contar. Sem limite de tamanho, qualquer um encheria a tabela mandando
 * megabytes por requisição. O corte descarta a atualização inteira em vez de
 * gravar pela metade: telemetria truncada mente, e mentira em painel é pior que
 * lacuna.
 */
export async function mesclar(
  deviceId: string,
  userId: string | null,
  pedaco: Record<string, unknown>,
): Promise<'ok' | 'grande-demais'> {
  const atual = await prisma.telemetryDevice.findUnique({ where: { deviceId } });
  const fundido = fundir((atual?.data as Record<string, unknown>) ?? {}, pedaco);

  if (!tamanhoAceitavel(JSON.stringify(fundido))) return 'grande-demais';

  // `userId` só AVANÇA DE NULO para uma conta, e agora o código faz o que o
  // comentário sempre prometeu. O `...(userId ? { userId } : {})` SOBRESCREVIA
  // um vínculo existente, e num endereço de escrita aberto isso é sequestro: o
  // aparelho é identificado pelo id que o cliente manda, então bastava alguém
  // com conta mandar um pedaço qualquer para o `deviceId` de outra pessoa para
  // que o aparelho dela passasse a contar como dele no painel.
  const podeVincular = userId !== null && !atual?.userId;

  await prisma.telemetryDevice.upsert({
    where: { deviceId },
    create: { deviceId, userId, data: fundido as object },
    update: { data: fundido as object, ...(podeVincular ? { userId } : {}) },
  });
  return 'ok';
}

/** O painel: aparelhos por atividade recente, anônimos incluídos. */
export async function listar(limite = 200): Promise<TelemetryRow[]> {
  const linhas = await prisma.telemetryDevice.findMany({
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(limite, 1), 500),
  });
  return linhas.map((l) => ({
    deviceId: l.deviceId,
    userId: l.userId,
    data: (l.data as Record<string, unknown>) ?? {},
    updatedAt: l.updatedAt,
  }));
}
