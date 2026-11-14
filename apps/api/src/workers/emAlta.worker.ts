/**
 * O AGENTE DE PARADAS — "em alta" por gênero, sempre fresco, no servidor.
 *
 * De tempos em tempos (`EM_ALTA_INTERVALO_MIN`, 30 min por padrão) ele lê as
 * paradas públicas — Deezer por gênero, Apple por gênero, YouTube "Top 100
 * Brazil/Global" pelo importador — funde tudo por música (`emAlta.ts`), marca o
 * que o acervo já tem, e grava UM retrato em `WorkerState` (`emAlta.paradas`).
 * A Home lê esse retrato por `GET /em-alta`; nenhuma página consulta parada
 * nenhuma na hora.
 *
 * Fonte que falha não derruba a batida: o retrato sai com o que respondeu, e o
 * log diz qual fonte ficou de fora. Só não grava nada quando NENHUMA fonte
 * respondeu — um retrato vazio apagaria o anterior, que ainda é melhor que
 * tela em branco.
 *
 * Configuração por variáveis de ambiente lidas aqui mesmo (não em
 * `config/env.ts`): `EM_ALTA_ENABLED` (`false` desliga), `EM_ALTA_INTERVALO_MIN`
 * (mín. 30), `EM_ALTA_POR_GENERO` (faixas por gênero, 30), `EM_ALTA_YOUTUBE`
 * (`false` pula o importador). O YouTube ainda exige `IMPORTER_URL` e
 * `IMPORT_SERVICE_TOKEN`, os mesmos do agente pesquisador.
 */
import { env } from '../config/index.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { gravarEmAlta } from '../modules/emAlta/emAlta.repository.js';
import {
  entradasDaApple,
  entradasDoDeezer,
  ehLinkDoYoutube,
  entradasDoYoutube,
  escolherVideoDaFaixa,
  fundirParadas,
  generoDoFunkDaApple,
  idsDoRssDaApple,
  PARADA_FUNK_APPLE,
  PARADAS_APPLE,
  PARADAS_DEEZER,
  PLAYLISTS_YOUTUBE,
  type AppleLookup,
  type EntradaDeParada,
  type FaixaDoAcervo,
  type ResultadoDeBusca,
} from './emAlta.js';
import type { FaixaEmAlta, GeneroEmAlta } from '@radinho/shared';
import { baseInterna, cabecalhos } from './varreduraNoturna.worker.js';

const log = logger.child({ worker: 'emAlta' });

/** Tempo máximo por pedido: parada que não responde não segura a batida. */
const TIMEOUT_MS = 20_000;
/** Respiro entre pedidos à mesma fonte (o Deezer aceita ~50 a cada 5 s). */
const RESPIRO_MS = 250;
/** Quantas posições de cada parada entram. */
const PROFUNDIDADE = 50;

function ligado(nome: string, padrao = true): boolean {
  const v = (process.env[nome] ?? '').trim().toLowerCase();
  if (!v) return padrao;
  return v !== 'false' && v !== '0' && v !== 'off';
}

function numero(nome: string, padrao: number, minimo: number): number {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v >= minimo ? Math.floor(v) : padrao;
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function lerJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controlador.signal,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

export interface LeituraDeFonte {
  fonte: 'deezer' | 'apple' | 'youtube';
  entradas: EntradaDeParada[];
  /** Paradas que não responderam (rótulo → erro). */
  falhas: Record<string, string>;
}

async function lerDeezer(): Promise<LeituraDeFonte> {
  const saida: LeituraDeFonte = { fonte: 'deezer', entradas: [], falhas: {} };
  for (const parada of PARADAS_DEEZER) {
    try {
      const json = (await lerJson(
        `https://api.deezer.com/chart/${parada.id}/tracks?limit=${PROFUNDIDADE}`,
      )) as { data?: unknown };
      saida.entradas.push(...entradasDoDeezer(parada.id, parada.genero, json));
    } catch (err) {
      saida.falhas[`deezer:${parada.id}`] = String(err);
    }
    await esperar(RESPIRO_MS);
  }
  return saida;
}

async function lerApple(): Promise<LeituraDeFonte> {
  const saida: LeituraDeFonte = { fonte: 'apple', entradas: [], falhas: {} };
  for (const parada of PARADAS_APPLE) {
    try {
      const rss = await lerJson(
        `https://itunes.apple.com/br/rss/topsongs/genre=${parada.id}/limit=${PROFUNDIDADE}/json`,
      );
      const ids = idsDoRssDaApple(rss);
      const lookup = new Map<string, AppleLookup>();
      if (ids.length > 0) {
        await esperar(RESPIRO_MS);
        const detalhe = (await lerJson(
          `https://itunes.apple.com/lookup?id=${ids.join(',')}&entity=song&country=br`,
        )) as { results?: AppleLookup[] };
        for (const r of detalhe.results ?? []) {
          if (typeof r?.trackId === 'number') lookup.set(String(r.trackId), r);
        }
      }
      saida.entradas.push(
        ...entradasDaApple(
          parada.genero,
          rss,
          lookup,
          parada.id === PARADA_FUNK_APPLE ? generoDoFunkDaApple : undefined,
        ),
      );
    } catch (err) {
      saida.falhas[`apple:${parada.id}`] = String(err);
    }
    await esperar(RESPIRO_MS);
  }
  return saida;
}

async function lerYoutube(): Promise<LeituraDeFonte> {
  const saida: LeituraDeFonte = { fonte: 'youtube', entradas: [], falhas: {} };
  if (!ligado('EM_ALTA_YOUTUBE') || !baseInterna() || !env.IMPORT_SERVICE_TOKEN) {
    saida.falhas.youtube = 'desligado (EM_ALTA_YOUTUBE, IMPORTER_URL ou IMPORT_SERVICE_TOKEN)';
    return saida;
  }
  for (const lista of PLAYLISTS_YOUTUBE) {
    try {
      const json = (await lerJson(`${baseInterna()}/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cabecalhos() },
        body: JSON.stringify({ url: `https://www.youtube.com/playlist?list=${lista.id}` }),
      })) as { entries?: Array<{ url: string; title: string; duracaoSeg?: number }> };
      saida.entradas.push(...entradasDoYoutube((json.entries ?? []).slice(0, PROFUNDIDADE)));
    } catch (err) {
      saida.falhas[`youtube:${lista.rotulo}`] = String(err);
    }
  }
  return saida;
}

/** O acervo inteiro, só os campos que a fusão usa (nunca o `dna`). */
async function lerAcervo(): Promise<FaixaDoAcervo[]> {
  const linhas = await prisma.$queryRaw<
    Array<{
      id: string;
      titulo: string | null;
      artista: string | null;
      genero: string | null;
      veredicto: string | null;
      tocavel: boolean | null;
    }>
  >`
    SELECT id,
           data->'track'->>'title' AS titulo,
           data->'track'->'artists'->0->>'name' AS artista,
           data->'track'->>'genre' AS genero,
           data->'conteudo'->>'veredicto' AS veredicto,
           (data->>'remoteUrl' IS NOT NULL OR data->'track'->>'streamUrl' IS NOT NULL) AS tocavel
    FROM "CatalogTrack"
  `;
  return linhas
    .filter((l) => l.titulo && l.artista)
    .map((l) => ({
      id: l.id,
      titulo: l.titulo!,
      artista: l.artista!,
      genero: l.genero,
      veredicto:
        l.veredicto === 'explicito' || l.veredicto === 'limpo' || l.veredicto === 'desconhecido'
          ? l.veredicto
          : null,
      tocavel: l.tocavel === true,
    }));
}

export interface ResultadoDaBatida {
  gravou: boolean;
  motivo?: string;
  porFonte: Record<string, number>;
  falhas: Record<string, string>;
  generos: number;
  faixas: number;
  videosNovos?: number;
}

export async function lerParadasUmaVez(agora = new Date()): Promise<ResultadoDaBatida> {
  const leituras = await Promise.all([lerDeezer(), lerApple(), lerYoutube()]);
  const falhas = Object.assign({}, ...leituras.map((l) => l.falhas)) as Record<string, string>;
  const porFonte = Object.fromEntries(leituras.map((l) => [l.fonte, l.entradas.length]));
  const entradas = leituras.flatMap((l) => l.entradas);
  if (entradas.length === 0) {
    return {
      gravou: false,
      motivo: 'nenhuma fonte respondeu',
      porFonte,
      falhas,
      generos: 0,
      faixas: 0,
    };
  }
  const acervo = await lerAcervo();
  const generos = fundirParadas(entradas, acervo, {
    porGenero: numero('EM_ALTA_POR_GENERO', 30, 5),
  });
  // O retrato sai JÁ com os links do YouTube conhecidos; só depois o agente
  // procura os que faltam (devagar) e regrava se achou algum.
  const videos = await lerVideos();
  aplicarVideos(generos, videos);
  await gravarEmAlta({ atualizadoEm: agora.toISOString(), generos });
  const novos = await procurarVideos(generos, videos).catch((err) => {
    log.warn({ err }, 'paradas: busca de vídeos falhou');
    return 0;
  });
  if (novos > 0) {
    aplicarVideos(generos, videos);
    await gravarEmAlta({ atualizadoEm: agora.toISOString(), generos });
  }
  await aquecerTopo(generos).catch((err) => log.warn({ err }, 'paradas: aquecimento falhou'));
  const faixas = generos[0]?.faixas.length ?? 0;
  return { gravou: true, porFonte, falhas, generos: generos.length, faixas, videosNovos: novos };
}

// ── O topo já sai AQUECIDO ──────────────────────────────────────────────────
//
// Medido em 14/11/2026 no importador: faixa de fora do acervo, a frio, levou
// 36–40 s até o primeiro byte (extrair o áudio do YouTube custa 10–40 s com a
// máquina ocupada); com a URL direta já em cache, 0,46 s. O aparelho só aquece
// depois que a prateleira aparece — tarde para quem toca no primeiro cartão.
// Então o servidor mantém quente o que está no topo: a cada batida pede ao
// importador as URLs que ainda não estão em cache (ele mesmo pula as que
// estão), em levas pequenas e espaçadas, porque extrair é o que o YouTube
// limita por IP.

const TOPO_GERAL = 10;
const TOPO_POR_GENERO = 3;
const LEVA_DE_AQUECIMENTO = 8;
const RESPIRO_ENTRE_LEVAS_MS = 90_000;

/** Os links do YouTube do topo (geral e de cada gênero), sem repetir. */
export function linksDoTopo(generos: GeneroEmAlta[]): string[] {
  const links = new Set<string>();
  for (const [i, g] of generos.entries()) {
    const ate = i === 0 ? TOPO_GERAL : TOPO_POR_GENERO;
    for (const f of g.faixas.slice(0, ate))
      if (!f.acervoId && f.origem && ehLinkDoYoutube(f.origem)) links.add(f.origem);
  }
  return [...links];
}

async function aquecerTopo(generos: GeneroEmAlta[]): Promise<void> {
  if (!ligado('EM_ALTA_AQUECER') || !baseInterna() || !env.IMPORT_SERVICE_TOKEN) return;
  const links = linksDoTopo(generos);
  let pedidas = 0;
  for (let i = 0; i < links.length; i += LEVA_DE_AQUECIMENTO) {
    const json = (await lerJson(`${baseInterna()}/aquecer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cabecalhos() },
      body: JSON.stringify({ urls: links.slice(i, i + LEVA_DE_AQUECIMENTO) }),
    })) as { aquecendo?: number };
    const n = Number(json.aquecendo ?? 0);
    pedidas += n;
    // Leva que já estava toda em cache não custa nada: segue sem esperar.
    if (n > 0 && i + LEVA_DE_AQUECIMENTO < links.length) await esperar(RESPIRO_ENTRE_LEVAS_MS);
  }
  log.info({ topo: links.length, pedidas }, 'paradas: topo aquecido');
}

// ── O link do YouTube de cada faixa de fora do acervo ───────────────────────
//
// Medido em 14/11/2026: das 569 faixas de fora, só 18 traziam link do YouTube;
// as outras traziam o do Deezer/Apple, e o toque tinha de PROCURAR o vídeo e
// só então extrair o áudio — nada disso podia ser aquecido antes. Aqui o
// agente procura uma vez, guarda (`emAlta.videos`) e o retrato já sai com o
// link: o aparelho aquece o que está à vista e o toque começa em segundos.

const CHAVE_VIDEOS = 'emAlta.videos';
/** Buscas por batida — o importador aceita 40/min por origem; vamos a 24/min. */
const BUSCAS_POR_BATIDA = 120;
const RESPIRO_DE_BUSCA_MS = 2_500;
/** "Não achei" vale por um dia; depois tenta de novo. */
const REVER_VAZIO_MS = 24 * 3600_000;

type Videos = Record<string, { url: string | null; em: number }>;

async function lerVideos(): Promise<Videos> {
  const linha = await prisma.workerState.findUnique({ where: { key: CHAVE_VIDEOS } });
  const v = linha?.value;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as unknown as Videos) : {};
}

function aplicarVideos(generos: GeneroEmAlta[], videos: Videos): void {
  for (const g of generos)
    for (const f of g.faixas) {
      const url = videos[f.chave]?.url;
      if (!f.acervoId && url && !ehLinkDoYoutube(f.origem)) f.origem = url;
    }
}

async function procurarVideos(generos: GeneroEmAlta[], videos: Videos): Promise<number> {
  if (!baseInterna() || !env.IMPORT_SERVICE_TOKEN) return 0;
  // Quem está mais no topo primeiro — é o que aparece na tela.
  const pendentes = new Map<string, FaixaEmAlta>();
  const vivas = new Set<string>();
  const todas = generos.flatMap((g) => g.faixas).sort((a, b) => a.posicao - b.posicao);
  const agora = Date.now();
  for (const f of todas) {
    vivas.add(f.chave);
    if (f.acervoId || ehLinkDoYoutube(f.origem)) continue;
    const sabido = videos[f.chave];
    if (sabido && (sabido.url || agora - sabido.em < REVER_VAZIO_MS)) continue;
    if (!pendentes.has(f.chave)) pendentes.set(f.chave, f);
  }
  let novos = 0;
  let buscas = 0;
  for (const f of pendentes.values()) {
    if (buscas >= BUSCAS_POR_BATIDA) break;
    buscas += 1;
    try {
      const json = (await lerJson(
        `${baseInterna()}/buscar-youtube?q=${encodeURIComponent(`${f.artista} ${f.titulo}`)}`,
        { headers: cabecalhos() },
      )) as { resultados?: ResultadoDeBusca[] };
      const url = escolherVideoDaFaixa(json.resultados ?? [], f);
      videos[f.chave] = { url, em: Date.now() };
      if (url) novos += 1;
    } catch (err) {
      // 429/502: o importador pediu calma — para por aqui, a próxima batida continua.
      log.warn({ err: String(err), feitas: buscas }, 'paradas: busca de vídeo interrompida');
      break;
    }
    await esperar(RESPIRO_DE_BUSCA_MS);
  }
  // Só guarda o que ainda está em alguma parada: o mapa não cresce para sempre.
  for (const chave of Object.keys(videos)) if (!vivas.has(chave)) delete videos[chave];
  await prisma.workerState.upsert({
    where: { key: CHAVE_VIDEOS },
    create: { key: CHAVE_VIDEOS, value: videos as object },
    update: { value: videos as object },
  });
  if (buscas > 0) log.info({ buscas, novos, faltam: pendentes.size - buscas }, 'paradas: vídeos');
  return novos;
}

export function startEmAltaWorker(): () => void {
  if (!ligado('EM_ALTA_ENABLED')) {
    log.info('agente de paradas desligado (EM_ALTA_ENABLED=false)');
    return () => undefined;
  }
  const intervaloMin = numero('EM_ALTA_INTERVALO_MIN', 30, 30);
  let parado = false;
  let rodando = false;
  const bater = (): void => {
    if (parado || rodando) return;
    rodando = true;
    void lerParadasUmaVez()
      .then((r) => {
        if (!r.gravou) log.warn({ motivo: r.motivo, falhas: r.falhas }, 'paradas: nada gravado');
        else
          log.info(
            {
              porFonte: r.porFonte,
              generos: r.generos,
              noTopo: r.faixas,
              videosNovos: r.videosNovos,
              falhas: r.falhas,
            },
            'paradas gravadas',
          );
      })
      .catch((err) => log.error({ err }, 'agente de paradas falhou'))
      .finally(() => {
        rodando = false;
      });
  };
  // Primeira batida logo depois de subir: a Home não pode esperar 3 h.
  const primeira = setTimeout(bater, 20_000);
  const timer = setInterval(bater, intervaloMin * 60_000);
  primeira.unref?.();
  timer.unref?.();
  log.info({ intervaloMin }, 'agente de paradas iniciado');
  return () => {
    parado = true;
    clearTimeout(primeira);
    clearInterval(timer);
  };
}
