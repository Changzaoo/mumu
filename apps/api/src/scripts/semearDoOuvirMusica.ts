/**
 * SEMEAR O ACERVO a partir de uma lista de nomes (ver apps/api/dados/README.md).
 *
 *   node dist/scripts/semearDoOuvirMusica.js --lista dados/ouvirmusica.json --max 40
 *   npx tsx src/scripts/semearDoOuvirMusica.ts --dry-run
 *
 * Mesmo caminho do agente pesquisador (busca → escolha estrita → download →
 * cofre → CatalogTrack → letra), mas guiado por uma lista e sem `userId`: não
 * grava na biblioteca de ninguém. Retomável: o estado fica em
 * dados/semeadura.estado.json.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizarGenero } from '@radinho/shared';
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { upsertCatalogTrack, type CatalogEntry } from '../modules/catalog/catalog.repository.js';
import {
  baixar,
  baseInterna,
  cabecalhos,
  folgaDoCofre,
  guardarNoCofre,
} from '../workers/varreduraNoturna.worker.js';
import {
  chaveDaMusica,
  idiomaDaLetra,
  norm,
  type ResultadoDaBusca,
} from '../workers/pesquisador.worker.js';
import {
  chaveDeDedup,
  deveTentar,
  escolherResultado,
  gravarEstado,
  lerEstado,
  lerLista,
  semRepetidas,
  type Escolha,
  type MusicaDaLista,
} from './semear.js';

const log = logger.child({ script: 'semear' });
const FOLGA_MINIMA = 200 * 1024 * 1024;
const FONTE_DA_LISTA = 'ouvirmusica.com.br';

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ARQ_LISTA = resolve(arg('--lista') ?? 'dados/ouvirmusica.json');
const ARQ_ESTADO = resolve(process.env.SEMEADURA_ESTADO ?? 'dados/semeadura.estado.json');
const MAX = Math.max(1, Number(arg('--max') ?? 40) || 40);
const PAUSA_MS = Math.max(0, Number(arg('--pausa-ms') ?? 5000) || 0);
const DRY = process.argv.includes('--dry-run');

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Chaves "artista|título" do acervo, lidas em páginas de 500, sem o `dna`. */
async function chavesDoAcervo(): Promise<Set<string>> {
  const chaves = new Set<string>();
  let depois = '';
  for (;;) {
    const linhas = await prisma.$queryRaw<
      Array<{ id: string; titulo: string | null; artistas: unknown }>
    >`
      SELECT id, data->'track'->>'title' AS titulo, data->'track'->'artists' AS artistas
      FROM "CatalogTrack" WHERE id > ${depois} ORDER BY id LIMIT 500
    `;
    if (linhas.length === 0) break;
    for (const l of linhas) {
      if (!l.titulo || !Array.isArray(l.artistas)) continue;
      for (const a of l.artistas as Array<{ name?: unknown }>) {
        if (typeof a?.name === 'string') chaves.add(chaveDaMusica(a.name, l.titulo));
      }
    }
    depois = linhas[linhas.length - 1]!.id;
  }
  return chaves;
}

async function buscar(termo: string): Promise<ResultadoDaBusca[]> {
  const res = await fetch(`${baseInterna()}/buscar-youtube?q=${encodeURIComponent(termo)}`, {
    headers: cabecalhos(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`busca respondeu ${res.status}`);
  const dados = (await res.json()) as { resultados?: ResultadoDaBusca[] };
  return Array.isArray(dados.resultados) ? dados.resultados : [];
}

async function letraDe(
  titulo: string,
  artista: string,
  duracaoSeg: number,
): Promise<string[] | null> {
  const url = new URL('https://lrclib.net/api/get');
  url.searchParams.set('track_name', titulo);
  url.searchParams.set('artist_name', artista);
  url.searchParams.set('duration', String(Math.round(duracaoSeg)));
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const row = (await res.json().catch(() => null)) as {
    syncedLyrics?: string | null;
    plainLyrics?: string | null;
    duration?: number;
  } | null;
  if (!row) return null;
  if (typeof row.duration === 'number' && Math.abs(row.duration - duracaoSeg) > 4) return null;
  const texto = row.plainLyrics || row.syncedLyrics?.replace(/\[[^\]]*\]/g, '') || '';
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return linhas.length > 0 ? linhas : null;
}

/** 422/503 do importador não é erro: a letra se resolve depois. */
async function prepararLetra(
  id: string,
  token: string,
  titulo: string,
  artista: string,
  duracaoSeg: number,
): Promise<string> {
  const base = `${baseInterna()}/blob/${encodeURIComponent(id)}`;
  try {
    const linhas = await letraDe(titulo, artista, duracaoSeg);
    if (linhas) {
      const lang = idiomaDaLetra(linhas.join(' '));
      const res = await fetch(`${base}/alinhar?k=${encodeURIComponent(token)}&lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linhas }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok || res.status === 202) return 'alinhando';
      return res.status === 422 || res.status === 503 ? 'adiada' : `alinhar ${res.status}`;
    }
    const res = await fetch(`${base}/tempo?k=${encodeURIComponent(token)}&lang=auto`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok || res.status === 202) return 'transcrevendo';
    return res.status === 422 || res.status === 503 ? 'adiada' : `tempo ${res.status}`;
  } catch (err) {
    return `letra falhou: ${String(err)}`;
  }
}

async function trazer(m: MusicaDaLista, e: Escolha): Promise<{ id: string; letra: string } | null> {
  const r = e.resultado;
  const { ok } = await baixar(r.url);
  if (!ok) return null;
  const id = `local:${randomUUID()}`;
  const guardada = await guardarNoCofre(id, ok, r.url);
  if (!guardada.remoteUrl) return null;
  const token = new URL(guardada.remoteUrl).searchParams.get('k') ?? '';
  const genero = normalizarGenero(m.genero);
  const entry: CatalogEntry = {
    track: {
      id,
      album: null,
      label: null,
      title: e.faixa.title,
      artists: e.faixa.artists.map((name, i) => ({
        id: `local-artist:${id}:${i}`,
        name,
        slug: '',
        imageUrl: null,
      })),
      composer: null,
      coverUrl: r.capa,
      explicit: false,
      streamUrl: guardada.remoteUrl,
      discNumber: null,
      durationMs: r.duracaoSeg * 1000,
      playsCount: 0,
      downloadUrl: null,
      releaseYear: null,
      trackNumber: null,
      loudnessLufs: null,
      dominantColor: null,
      uploadedByUserId: null,
      ...(genero ? { genre: genero } : {}),
    },
    addedAt: new Date().toISOString(),
    mimeType: ok.tipo,
    sizeBytes: ok.bytes.length,
    sourceUrl: r.url,
    remoteUrl: guardada.remoteUrl,
    origemDoAgente: 'semeador',
    fonteDaLista: FONTE_DA_LISTA,
  };
  // A assinatura ganhou um `autor` no catálogo; aceitar as duas formas.
  const gravar = upsertCatalogTrack as unknown as (
    id: string,
    data: CatalogEntry,
    autor?: { id: string; admin: boolean },
  ) => Promise<unknown>;
  await gravar(id, entry, { id: 'semeador', admin: true });
  const letra = await prepararLetra(
    id,
    token,
    e.faixa.title,
    e.faixa.artists[0] ?? m.artista,
    r.duracaoSeg,
  );
  return { id, letra };
}

async function main(): Promise<void> {
  if (!baseInterna()) throw new Error('IMPORTER_URL não configurado');
  if (!env.IMPORT_SERVICE_TOKEN) throw new Error('IMPORT_SERVICE_TOKEN não configurado');
  const lista = lerLista(JSON.parse(readFileSync(ARQ_LISTA, 'utf8')));
  const musicas = semRepetidas(lista.musicas);
  const estado = lerEstado(ARQ_ESTADO);
  const salvar = (): void => {
    if (!DRY) gravarEstado(ARQ_ESTADO, estado);
  };
  let interrompido = false;
  process.on('SIGINT', () => {
    interrompido = true;
    salvar();
    log.warn('SIGINT: estado salvo, encerrando');
    process.exit(130);
  });

  const noAcervo = await chavesDoAcervo();
  log.info(
    { lista: musicas.length, acervo: noAcervo.size, max: MAX, dry: DRY },
    'semeadura começando',
  );
  const n = { novas: 0, noAcervo: 0, semResultado: 0, falhas: 0, puladas: 0 };
  let tentadas = 0;

  for (const m of musicas) {
    if (interrompido || tentadas >= MAX) break;
    const chave = chaveDeDedup(m.artista, m.titulo);
    if (noAcervo.has(chave)) {
      n.noAcervo++;
      continue;
    }
    if (!deveTentar(estado, chave)) {
      n.puladas++;
      continue;
    }
    const rotulo = `${m.artista} - ${m.titulo}`;
    if (DRY) {
      console.log(`[dry] tentaria: ${rotulo}`);
      tentadas++;
      continue;
    }
    const livre = await folgaDoCofre();
    if (livre === null || livre < FOLGA_MINIMA) {
      log.warn(
        { livreMB: livre === null ? null : Math.round(livre / 1e6) },
        'cofre sem folga: parando',
      );
      break;
    }
    tentadas++;
    const agora = new Date().toISOString();
    try {
      const resultados = await buscar(`${m.artista} ${m.titulo}`);
      const escolha = escolherResultado(m.artista, m.titulo, resultados);
      if (!escolha) {
        estado.semResultado[chave] = { em: agora };
        n.semResultado++;
        console.log(`sem resultado: ${rotulo} (${resultados.length} candidatos)`);
      } else {
        const feito = await trazer(m, escolha);
        if (!feito) throw new Error('download/cofre falhou');
        estado.feitas[chave] = { id: feito.id, em: agora };
        delete estado.falhas[chave];
        noAcervo.add(chave);
        n.novas++;
        console.log(`ok: ${rotulo} -> ${feito.id} (letra: ${feito.letra})`);
      }
    } catch (err) {
      const antes = estado.falhas[chave]?.tentativas ?? 0;
      estado.falhas[chave] = {
        em: agora,
        motivo: String(err).slice(0, 200),
        tentativas: antes + 1,
      };
      n.falhas++;
      console.log(`falhou: ${rotulo} (${String(err).slice(0, 120)})`);
    }
    salvar();
    if (PAUSA_MS > 0) await esperar(PAUSA_MS);
  }
  salvar();
  console.log(
    `resumo: ${n.novas} novas, ${n.noAcervo} já no acervo, ${n.semResultado} sem resultado, ${n.falhas} falhas, ${n.puladas} puladas pelo estado, ${tentadas} tentadas`,
  );
  void norm;
}

main()
  .catch((err) => {
    console.error('semeadura abortada:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
