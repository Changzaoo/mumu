/**
 * As coleções privadas de cada usuário — biblioteca, curtidas, playlists.
 *
 * SINCRONIA POR DELTA, e é o ponto do módulo. O Firestore mandava a coleção
 * INTEIRA no primeiro snapshot de toda sessão, cobrando uma leitura por
 * documento; aqui o cliente guarda um cursor e pergunta só "o que mudou desde
 * X". Na maioria das aberturas a resposta é uma lista vazia.
 *
 * TODA consulta filtra por `userId` vindo do token — nunca por um id que o
 * cliente mande no corpo ou na URL. Coleção privada trocada entre pessoas é o
 * tipo de erro que não dá para desfazer depois.
 */
import { prisma } from '../../infra/db/prisma.js';

export interface CollectionItem {
  id: string;
  data: unknown;
  deleted: boolean;
  updatedAt: string;
}

export interface CollectionDelta {
  itens: CollectionItem[];
  /**
   * Onde parar da próxima vez. É o `updatedAt` do item mais novo desta resposta
   * — e não "agora" — porque entre a consulta e a resposta pode ter entrado
   * escrita nova. Usar o relógio do servidor aqui pularia essa escrita para
   * sempre.
   */
  cursor: string | null;
}

/** Teto por resposta: uma biblioteca grande chega em páginas, não de uma vez. */
const PAGINA = 500;

/**
 * CAMPOS DO SERVIDOR NÃO VIAJAM PARA O APARELHO.
 *
 * O `dna` (vetor de 2048 números que a curadoria grava, ~40 KB por faixa) ia
 * inteiro para cada aparelho dentro de `data`: uma biblioteca de 5 mil faixas
 * eram 200 MB no localStorage do celular — e, pior, o aparelho devolvia tudo
 * ao publicar no acervo e ao sincronizar a biblioteca (100 faixas ≈ 4 MB), o
 * que o servidor recusa com 413 (teto de 1 MB). Medido em 20/10/2026: 41 KB
 * por item com `dna`, 1,3 KB sem. Sai aqui, na saída; e na entrada o que o
 * aparelho manda sem `dna` NÃO apaga o `dna` que o servidor já tinha.
 */
const CAMPOS_DO_SERVIDOR = ['dna'] as const;

export function semCamposDoServidor(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const copia = { ...(data as Record<string, unknown>) };
  for (const campo of CAMPOS_DO_SERVIDOR) delete copia[campo];
  return copia;
}

export async function listDelta(
  userId: string,
  collection: string,
  desde: Date | null,
): Promise<CollectionDelta> {
  const itens = await prisma.userCollectionItem.findMany({
    where: {
      userId,
      collection,
      ...(desde ? { updatedAt: { gt: desde } } : {}),
    },
    orderBy: { updatedAt: 'asc' },
    take: PAGINA,
  });

  return {
    itens: itens.map((i) => ({
      id: i.itemId,
      data: semCamposDoServidor(i.data),
      deleted: i.deleted,
      updatedAt: i.updatedAt.toISOString(),
    })),
    cursor: itens.at(-1)?.updatedAt.toISOString() ?? null,
  };
}

/** Grava (ou regrava) itens. Ressuscita o que estava apagado — é um upsert. */
export async function upsertItems(
  userId: string,
  collection: string,
  itens: Array<{ id: string; data: unknown }>,
): Promise<number> {
  if (itens.length === 0) return 0;
  // Upsert em SQL para PRESERVAR o `dna` do servidor: o aparelho nunca o tem
  // (ver `semCamposDoServidor`), e um `update: { data }` do Prisma trocaria o
  // documento inteiro, apagando o vetor que a curadoria levou horas para gravar.
  await prisma.$transaction(
    itens.map((item) => {
      const json = JSON.stringify(item.data ?? {});
      return prisma.$executeRaw`
        INSERT INTO "UserCollectionItem" ("userId", "collection", "itemId", "data", "deleted", "updatedAt", "createdAt")
        VALUES (${userId}, ${collection}, ${item.id}, ${json}::jsonb, false, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
        ON CONFLICT ("userId", "collection", "itemId") DO UPDATE SET
          "data" = CASE
            WHEN EXCLUDED."data" ? 'dna' OR NOT ("UserCollectionItem"."data" ? 'dna') THEN EXCLUDED."data"
            ELSE EXCLUDED."data" || jsonb_build_object('dna', "UserCollectionItem"."data" -> 'dna')
          END,
          "deleted" = false,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      `;
    }),
  );
  return itens.length;
}

/**
 * Apaga deixando LÁPIDE — nunca some da tabela.
 *
 * Um `DELETE` de verdade seria invisível para a sincronia por delta: o outro
 * aparelho pede "o que mudou desde X", não recebe nada sobre o item, e continua
 * exibindo a faixa que você removeu. Para sempre.
 */
export async function tombstoneItems(
  userId: string,
  collection: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const { count } = await prisma.userCollectionItem.updateMany({
    where: { userId, collection, itemId: { in: ids } },
    data: { deleted: true, data: {} },
  });
  return count;
}
