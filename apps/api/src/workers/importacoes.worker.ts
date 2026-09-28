/**
 * OS LINKS COLADOS TERMINAM DE BAIXAR MESMO COM O APP FECHADO.
 *
 * Cada link colado vira um registro na coleção `importacoes` da pessoa
 * (apps/web/src/lib/local/importacoesNaConta.ts). Com o app aberto, o próprio
 * aparelho baixa e marca "feito". O que continua "pendente" depois de alguns
 * minutos sem novidade é trabalho que o aparelho não vai terminar — a pessoa
 * fechou o navegador, o celular matou o app —, e é aqui que ele termina:
 *
 *   • PLAYLIST: o importador lista as faixas; cada uma vira um registro
 *     pendente próprio (a próxima batida as baixa), e a playlist fica
 *     "expandida";
 *   • MÚSICA: o importador baixa, o cofre guarda (com a origem, para a poda
 *     ser reversível), e a faixa entra na BIBLIOTECA da pessoa e no catálogo —
 *     a sincronia leva para todos os aparelhos; o registro vira "feito".
 *
 * Os dois lados usam o MESMO id por link (`idDaImportacao`, no shared): o
 * aparelho que volta e ainda tinha o link na fila vê a faixa na biblioteca
 * (pela origem) e não baixa de novo.
 *
 * Falha de faixa (vídeo removido) vira "erro" na hora; falha do mundo (rede,
 * importador fora) espera a próxima batida, até um teto de tentativas.
 */
import { randomUUID } from 'node:crypto';
import { idDaImportacao, lerTituloDoAcervo, type ImportacaoNaConta } from '@radinho/shared';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { upsertCatalogTrack, type CatalogEntry } from '../modules/catalog/catalog.repository.js';
import { baixar, baseInterna, cabecalhos, guardarNoCofre } from './varreduraNoturna.worker.js';
import { env } from '../config/index.js';

const log = logger.child({ worker: 'importacoes' });

/** De quanto em quanto tempo o worker olha a fila. */
const BATIDA_MS = 2 * 60_000;
/** Sem novidade por este tempo, o aparelho não vai terminar: o servidor pega. */
const CARENCIA_MIN = 8;
/** Registros por batida (somando todas as pessoas). */
const POR_BATIDA = 6;
/** Falhas transitórias antes de desistir de um link. */
const TENTATIVAS_MAX = 5;

/** O link é uma lista inteira (e não um vídeo dentro de uma lista)? */
export function ehPlaylist(url: string, forcePlaylist = false): boolean {
  try {
    const u = new URL(url);
    if (!u.searchParams.get('list')) return /\/(?:playlist|sets|album)\b/.test(u.pathname);
    return forcePlaylist || !u.searchParams.get('v');
  } catch {
    return false;
  }
}

/** Título e artistas a partir do que o importador leu do vídeo. */
export function nomeDaFaixa(meta: {
  title?: string | null;
  track?: string | null;
  artist?: string | null;
  uploader?: string | null;
}): { title: string; artists: string[] } {
  const artista = (meta.artist || meta.uploader || '')
    .replace(/\s*(?:-\s*topic|vevo|official|oficial|tv)\s*$/i, '')
    .trim();
  const bruto = (meta.track || meta.title || '').trim();
  const lido = artista ? lerTituloDoAcervo(bruto, [artista]) : null;
  if (lido?.title) return { title: lido.title, artists: lido.artists };
  return { title: bruto || 'Sem título', artists: artista ? [artista] : ['Desconhecido'] };
}

interface Registro {
  userId: string;
  itemId: string;
  data: ImportacaoNaConta;
}

async function gravar(userId: string, itemId: string, data: ImportacaoNaConta): Promise<void> {
  await prisma.userCollectionItem.upsert({
    where: { userId_collection_itemId: { userId, collection: 'importacoes', itemId } },
    create: { userId, collection: 'importacoes', itemId, data: data as object },
    update: { data: data as object, deleted: false },
  });
}

async function pendentes(): Promise<Registro[]> {
  const linhas = await prisma.$queryRaw<Array<{ userId: string; itemId: string; data: unknown }>>`
    SELECT "userId", "itemId", data FROM "UserCollectionItem"
    WHERE collection = 'importacoes' AND deleted = false
      AND data->>'estado' = 'pendente'
      AND "updatedAt" < now() - make_interval(mins => ${CARENCIA_MIN})
    ORDER BY "updatedAt" ASC
    LIMIT ${POR_BATIDA}
  `;
  return linhas.map((l) => ({ ...l, data: l.data as ImportacaoNaConta }));
}

/** A biblioteca da pessoa já tem uma faixa com esta origem (pelo id do vídeo)? */
async function jaNaBiblioteca(userId: string, url: string): Promise<string | null> {
  const video =
    /[?&]v=([A-Za-z0-9_-]{11})/.exec(url)?.[1] ?? /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url)?.[1];
  const padrao = video ? `%${video}%` : url;
  const linhas = await prisma.$queryRaw<Array<{ titulo: string | null }>>`
    SELECT data->'track'->>'title' AS titulo FROM "UserCollectionItem"
    WHERE "userId" = ${userId} AND collection = 'library' AND deleted = false
      AND data->>'sourceUrl' LIKE ${padrao}
    LIMIT 1
  `;
  return linhas[0] ? (linhas[0].titulo ?? '') : null;
}

async function expandir(r: Registro): Promise<void> {
  const res = await fetch(`${baseInterna()}/playlist`, {
    method: 'POST',
    headers: { ...cabecalhos(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: r.data.url }),
  });
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    await gravar(r.userId, r.itemId, { ...r.data, estado: 'erro', atualizadoEm: agoraIso() });
    return;
  }
  if (!res.ok) throw new Error(`playlist respondeu ${res.status}`);
  const dados = (await res.json()) as { title?: string; entries?: Array<{ url?: string }> };
  const agora = agoraIso();
  let novas = 0;
  for (const e of dados.entries ?? []) {
    if (typeof e.url !== 'string' || !e.url) continue;
    const id = idDaImportacao(e.url);
    const existe = await prisma.userCollectionItem.findUnique({
      where: {
        userId_collection_itemId: { userId: r.userId, collection: 'importacoes', itemId: id },
      },
      select: { itemId: true },
    });
    if (existe) continue;
    // `criadoEm` antigo de propósito não importa: a carência conta pelo
    // `updatedAt`, e o servidor é quem vai baixar — já passou da hora.
    await gravar(r.userId, id, {
      url: e.url,
      estado: 'pendente',
      criadoEm: agora,
      atualizadoEm: agora,
    });
    novas++;
  }
  await gravar(r.userId, r.itemId, {
    ...r.data,
    estado: 'expandida',
    atualizadoEm: agora,
    ...(dados.title ? { titulo: dados.title } : {}),
  });
  log.info({ userId: r.userId, faixas: novas }, 'playlist expandida pelo servidor');
}

async function baixarFaixa(r: Registro): Promise<void> {
  const jaTem = await jaNaBiblioteca(r.userId, r.data.url);
  if (jaTem !== null) {
    await gravar(r.userId, r.itemId, {
      ...r.data,
      estado: 'feito',
      atualizadoEm: agoraIso(),
      titulo: jaTem,
    });
    return;
  }
  const { ok, permanente } = await baixar(r.data.url);
  if (!ok) {
    if (permanente) {
      await gravar(r.userId, r.itemId, { ...r.data, estado: 'erro', atualizadoEm: agoraIso() });
      return;
    }
    throw new Error('download falhou (transitório)');
  }
  const id = `local:${randomUUID()}`;
  const guardada = await guardarNoCofre(id, ok, r.data.url);
  if (guardada.grandeDemais) {
    await gravar(r.userId, r.itemId, {
      ...r.data,
      estado: 'erro',
      erro: 'grande demais para o cofre',
      atualizadoEm: agoraIso(),
    });
    return;
  }
  if (!guardada.remoteUrl) throw new Error('cofre não guardou');
  const { title, artists } = nomeDaFaixa(ok.meta ?? {});
  const entry: CatalogEntry = {
    track: {
      id,
      album: ok.meta?.album
        ? { id: `local-album:${id}`, slug: '', title: ok.meta.album, coverUrl: null }
        : null,
      label: null,
      title,
      artists: artists.map((name, i) => ({
        id: `local-artist:${id}:${i}`,
        name,
        slug: '',
        imageUrl: null,
      })),
      composer: null,
      coverUrl: ok.meta?.coverUrl ?? null,
      explicit: false,
      streamUrl: guardada.remoteUrl,
      discNumber: null,
      // A duração o aparelho mede na primeira vez que tocar (setTrackDuration).
      durationMs: 0,
      playsCount: 0,
      downloadUrl: null,
      releaseYear: null,
      trackNumber: null,
      loudnessLufs: null,
      dominantColor: null,
      uploadedByUserId: null,
    },
    addedAt: agoraIso(),
    mimeType: ok.tipo,
    sizeBytes: ok.bytes.length,
    sourceUrl: r.data.url,
    remoteUrl: guardada.remoteUrl,
  };
  await upsertCatalogTrack(id, entry);
  await prisma.userCollectionItem.upsert({
    where: { userId_collection_itemId: { userId: r.userId, collection: 'library', itemId: id } },
    create: { userId: r.userId, collection: 'library', itemId: id, data: entry as object },
    update: { data: entry as object, deleted: false },
  });
  await gravar(r.userId, r.itemId, {
    ...r.data,
    estado: 'feito',
    atualizadoEm: agoraIso(),
    titulo: title,
  });
  log.info({ userId: r.userId, id, titulo: title }, 'link terminado pelo servidor');
}

function agoraIso(): string {
  return new Date().toISOString();
}

export async function terminarPendentes(): Promise<{ vistos: number; falhas: number }> {
  const lista = await pendentes();
  let falhas = 0;
  for (const r of lista) {
    try {
      if (ehPlaylist(r.data.url, r.data.forcePlaylist)) await expandir(r);
      else await baixarFaixa(r);
    } catch (err) {
      falhas++;
      const tentativas = (r.data.tentativas ?? 0) + 1;
      await gravar(r.userId, r.itemId, {
        ...r.data,
        tentativas,
        estado: tentativas >= TENTATIVAS_MAX ? 'erro' : 'pendente',
        erro: String(err).slice(0, 200),
        atualizadoEm: agoraIso(),
      }).catch(() => undefined);
    }
  }
  return { vistos: lista.length, falhas };
}

export function startImportacoesWorker(): () => void {
  if (!baseInterna() || !env.IMPORT_SERVICE_TOKEN) {
    logger.info('importações pelo servidor desligadas (falta IMPORTER_URL/IMPORT_SERVICE_TOKEN)');
    return () => undefined;
  }
  let rodando = false;
  const timer = setInterval(() => {
    if (rodando) return;
    rodando = true;
    void terminarPendentes()
      .then((r) => {
        if (r.vistos > 0) log.info(r, 'importações pendentes tratadas');
      })
      .catch((err) => log.error({ err }, 'importações pelo servidor falharam'))
      .finally(() => {
        rodando = false;
      });
  }, BATIDA_MS);
  timer.unref?.();
  logger.info('importações pelo servidor iniciadas (links que o aparelho não terminou)');
  return () => clearInterval(timer);
}
