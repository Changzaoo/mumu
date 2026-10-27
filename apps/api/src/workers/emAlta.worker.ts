/**
 * O AGENTE DE PARADAS — "em alta" por gênero, sempre fresco, no servidor.
 *
 * De tempos em tempos (`EM_ALTA_INTERVALO_MIN`, 3 h por padrão) ele lê as
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
  entradasDoYoutube,
  fundirParadas,
  idsDoRssDaApple,
  PARADAS_APPLE,
  PARADAS_DEEZER,
  PLAYLISTS_YOUTUBE,
  type AppleLookup,
  type EntradaDeParada,
  type FaixaDoAcervo,
} from './emAlta.js';
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
      saida.entradas.push(...entradasDaApple(parada.genero, rss, lookup));
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
}

export async function lerParadasUmaVez(agora = new Date()): Promise<ResultadoDaBatida> {
  const leituras = await Promise.all([lerDeezer(), lerApple(), lerYoutube()]);
  const falhas = Object.assign({}, ...leituras.map((l) => l.falhas)) as Record<string, string>;
  const porFonte = Object.fromEntries(leituras.map((l) => [l.fonte, l.entradas.length]));
  const entradas = leituras.flatMap((l) => l.entradas);
  if (entradas.length === 0) {
    return { gravou: false, motivo: 'nenhuma fonte respondeu', porFonte, falhas, generos: 0, faixas: 0 };
  }
  const acervo = await lerAcervo();
  const generos = fundirParadas(entradas, acervo, {
    porGenero: numero('EM_ALTA_POR_GENERO', 30, 5),
  });
  await gravarEmAlta({ atualizadoEm: agora.toISOString(), generos });
  const faixas = generos[0]?.faixas.length ?? 0;
  return { gravou: true, porFonte, falhas, generos: generos.length, faixas };
}

export function startEmAltaWorker(): () => void {
  if (!ligado('EM_ALTA_ENABLED')) {
    log.info('agente de paradas desligado (EM_ALTA_ENABLED=false)');
    return () => undefined;
  }
  const intervaloMin = numero('EM_ALTA_INTERVALO_MIN', 180, 30);
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
            { porFonte: r.porFonte, generos: r.generos, noTopo: r.faixas, falhas: r.falhas },
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
