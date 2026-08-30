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

/**
 * CAMPOS QUE SÃO SÓ DO SERVIDOR — não descem para o cliente, e o cliente não
 * pode apagá-los.
 *
 * `dna` é o vetor semântico de 2048 dimensões que a curadoria grava para
 * comparar faixas. Medido no acervo em 2026-08-30: só 266 das 5.053 entradas
 * têm o vetor, e essas 266 sozinhas eram **10,01 MB de 15,69 MB — 71% do peso
 * de todos os campos somados**. Cada vetor ocupa ~39 KB escrito como JSON.
 *
 * E o app nunca leu isso: não há UMA referência a `dna` em `apps/web/src`. Era
 * download, `JSON.parse` e gravação em IndexedDB de dez megabytes que ninguém
 * abria — no celular modesto, o pico de memória e o tempo de parse que atrasam
 * a primeira faixa aparecer.
 *
 * Tirar da LISTAGEM não pode virar apagar do BANCO: o cliente republica faixas
 * (`PUT /catalogo/:id`, `POST /bulk`) e a gravação substitui o documento
 * inteiro. Sem a preservação abaixo, a primeira republicação zeraria o vetor de
 * volta — a curadoria refaria, o cliente apagaria de novo, para sempre.
 */
const CAMPOS_DO_SERVIDOR = ['dna'] as const;

/** A entrada como o cliente a recebe: sem o que é só nosso. */
export function semCamposDoServidor(entry: CatalogEntry): CatalogEntry {
  if (!CAMPOS_DO_SERVIDOR.some((campo) => campo in entry)) return entry;
  const copia: CatalogEntry = { ...entry };
  for (const campo of CAMPOS_DO_SERVIDOR) delete copia[campo];
  return copia;
}

/** A entrada como ela deve ser GRAVADA: o que o cliente mandou, mais o que só
 *  o servidor sabe e que ele não tinha como devolver. */
export function comCamposDoServidor(
  recebida: CatalogEntry,
  anterior: CatalogEntry | null,
): CatalogEntry {
  if (!anterior) return recebida;
  let saida = recebida;
  for (const campo of CAMPOS_DO_SERVIDOR) {
    if (campo in recebida) continue; // veio preenchido: respeita quem mandou
    if (!(campo in anterior)) continue;
    if (saida === recebida) saida = { ...recebida };
    saida[campo] = anterior[campo];
  }
  return saida;
}

export async function listCatalog(): Promise<CatalogSnapshot> {
  const [rows, etag] = await Promise.all([
    prisma.catalogTrack.findMany({ orderBy: { updatedAt: 'desc' } }),
    catalogEtag(),
  ]);
  return { entries: rows.map((r) => semCamposDoServidor(r.data as CatalogEntry)), etag };
}

/** Publica (ou atualiza) uma faixa. O id é o do cliente — ver o schema. */
export async function upsertCatalogTrack(id: string, data: CatalogEntry): Promise<void> {
  const anterior = await prisma.catalogTrack.findUnique({ where: { id }, select: { data: true } });
  const completa = comCamposDoServidor(data, (anterior?.data as CatalogEntry) ?? null);
  await prisma.catalogTrack.upsert({
    where: { id },
    create: { id, data: completa as object },
    update: { data: completa as object },
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
  // UMA leitura para o lote inteiro: sem ela, preservar o `dna` custaria uma
  // consulta por faixa e a reconciliação de um aparelho novo (500 por vez)
  // viraria 500 idas ao banco.
  const anteriores = await prisma.catalogTrack.findMany({
    where: { id: { in: entradas.map((e) => e.id) } },
    select: { id: true, data: true },
  });
  const porId = new Map(anteriores.map((a) => [a.id, a.data as CatalogEntry]));
  const completas = entradas.map((e) => ({
    id: e.id,
    data: comCamposDoServidor(e.data, porId.get(e.id) ?? null),
  }));
  await prisma.$transaction(
    completas.map((e) =>
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
