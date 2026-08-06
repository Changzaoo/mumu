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
      data: i.data,
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
  await prisma.$transaction(
    itens.map((item) =>
      prisma.userCollectionItem.upsert({
        where: { userId_collection_itemId: { userId, collection, itemId: item.id } },
        create: {
          userId,
          collection,
          itemId: item.id,
          data: item.data as object,
          deleted: false,
        },
        update: { data: item.data as object, deleted: false },
      }),
    ),
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
