/**
 * Telemetria por aparelho — leitura e escrita.
 *
 * A escrita é uma FUSÃO rasa: o cliente manda pedaços (tempo de tela agora, top
 * de faixas depois, rede quando mede) e cada um substitui só a sua chave. Era o
 * `{ merge: true }` do Firestore; aqui é explícito.
 */
import { prisma } from '../../infra/db/prisma.js';

/** Teto do documento por aparelho. Ver o comentário em `mesclar`. */
const MAX_BYTES = 64 * 1024;

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

  if (JSON.stringify(fundido).length > MAX_BYTES) return 'grande-demais';

  await prisma.telemetryDevice.upsert({
    where: { deviceId },
    create: { deviceId, userId, data: fundido as object },
    // `userId` só AVANÇA de nulo para uma conta: um aparelho que já se
    // identificou não volta a ser anônimo porque a sessão expirou no meio de
    // uma medição — isso quebraria o vínculo "visitante de ontem virou usuário".
    update: { data: fundido as object, ...(userId ? { userId } : {}) },
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
