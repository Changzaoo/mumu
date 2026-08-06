/**
 * O ACERVO no Postgres — a leitura que saiu do Firestore.
 *
 * Por que saiu: a coleção INTEIRA era lida a cada abertura do app, por cada
 * pessoa, mais a varredura horária do worker. O limite grátis de 50 mil
 * leituras/dia é do PROJETO, então quando ele estourava caía tudo junto —
 * acervo, sincronia entre aparelhos, curtidas. Aconteceu três vezes.
 *
 * Aqui não há pedágio por leitura. E a máquina que serve isto já é dependência
 * dura para tocar (todo áudio sai dela), então a listagem vir daqui não cria
 * nenhum ponto de falha novo.
 */
import { prisma } from '../../infra/db/prisma.js';

/** A entrada como o cliente a conhece — trafega inteira, sem tradução. */
export type CatalogEntry = Record<string, unknown>;

export interface CatalogSnapshot {
  entries: CatalogEntry[];
  /** Identidade do conteúdo, para o `If-None-Match` do cliente. */
  etag: string;
}

/**
 * A assinatura do acervo sem ler o acervo.
 *
 * `count` pega remoção e inclusão; `max(updatedAt)` pega edição. Juntos
 * descrevem qualquer mudança, e as duas saem de uma agregação que o índice de
 * `updatedAt` resolve na hora — muito mais barato que serializar centenas de
 * faixas para descobrir que nada mudou.
 */
export async function catalogEtag(): Promise<string> {
  const agg = await prisma.catalogTrack.aggregate({
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  const carimbo = agg._max.updatedAt?.getTime() ?? 0;
  return `W/"${agg._count._all}-${carimbo}"`;
}

export async function listCatalog(): Promise<CatalogSnapshot> {
  const [rows, etag] = await Promise.all([
    prisma.catalogTrack.findMany({ orderBy: { updatedAt: 'desc' } }),
    catalogEtag(),
  ]);
  return { entries: rows.map((r) => r.data as CatalogEntry), etag };
}

/** Publica (ou atualiza) uma faixa. O id é o do cliente — ver o schema. */
export async function upsertCatalogTrack(id: string, data: CatalogEntry): Promise<void> {
  await prisma.catalogTrack.upsert({
    where: { id },
    create: { id, data: data as object },
    update: { data: data as object },
  });
}

/**
 * Publica várias de uma vez.
 *
 * Existe porque a reconciliação do cliente sobe o que falta — e um aparelho com
 * trezentas faixas faria trezentas requisições, cada uma com ida e volta pelo
 * túnel. Em lote é uma só.
 */
export async function upsertCatalogTracks(
  entradas: Array<{ id: string; data: CatalogEntry }>,
): Promise<number> {
  if (entradas.length === 0) return 0;
  await prisma.$transaction(
    entradas.map((e) =>
      prisma.catalogTrack.upsert({
        where: { id: e.id },
        create: { id: e.id, data: e.data as object },
        update: { data: e.data as object },
      }),
    ),
  );
  return entradas.length;
}

export async function deleteCatalogTrack(id: string): Promise<void> {
  await prisma.catalogTrack.deleteMany({ where: { id } }); // idempotente
}
