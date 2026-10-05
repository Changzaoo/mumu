/**
 * Busca por TRECHO DE LETRA — digitado ou falado no microfone (a transcrição
 * de voz chega imperfeita, então além do casamento exato há um fuzzy por
 * cobertura de palavras). Fonte: o cache local de letras (LRCLIB) que o app já
 * alimenta ao baixar/enriquecer faixas; um indexador em segundo plano
 * (indexLyricsInBackground) vai completando o cache da biblioteca aos poucos.
 */
import type { TrackDto } from '@radinho/shared';
import { corrigirGrafia, normalizarLetra } from '@/lib/lyrics/grafia';
import { cachedLyrics, fetchLyrics, lyricsCacheEntries, type Lyrics } from '@/lib/lyrics/lyrics';

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface LyricMatch {
  trackId: string;
  /** A linha da letra onde o trecho foi encontrado (para mostrar na busca). */
  excerpt: string;
  /** 0..100 — exato > fuzzy; ordena a seção. */
  score: number;
}

// Texto normalizado por faixa, memoizado — recalcular a cada tecla seria caro.
// A chave de validade é a PRÓPRIA letra (referência), não o nº de linhas: uma
// letra regravada com o mesmo número de linhas (alinhada ao áudio, ou trocada
// pela que a voz confirmou) tem texto novo e não pode ser buscada pelo índice
// da antiga.
interface Indexada {
  fonte: Lyrics;
  /** Linhas normalizadas (sem vazias) e, em paralelo, o texto exibido de cada uma. */
  lines: string[];
  exibidas: string[];
  full: string;
}
const normalizedCache = new Map<string, Indexada>();

/**
 * A busca compara o texto COMO É EXIBIDO: a tela mostra "nós" para uma letra
 * guardada como "nois" (grafia.ts), então quem digita "nós" tem que achá-la.
 * O cache de letras não é tocado — só este índice.
 */
function normalizedLyrics(trackId: string, lyrics: Lyrics): Indexada {
  const cached = normalizedCache.get(trackId);
  if (cached && cached.fonte === lyrics) return cached;
  const lines: string[] = [];
  const exibidas: string[] = [];
  for (const l of normalizarLetra(lyrics).lines) {
    const n = norm(l.text);
    if (!n) continue;
    lines.push(n);
    exibidas.push(l.text);
  }
  const entry = { fonte: lyrics, lines, exibidas, full: lines.join(' ') };
  normalizedCache.set(trackId, entry);
  return entry;
}

/** Linha exibida mais próxima do trecho — vira o excerpt mostrado na busca. */
function bestExcerpt(entry: Indexada, tokens: string[]): string {
  let best = '';
  let bestHits = 0;
  entry.lines.forEach((nline, i) => {
    let hits = 0;
    for (const t of tokens) if (nline.includes(t)) hits += 1;
    if (hits > bestHits) {
      bestHits = hits;
      best = entry.exibidas[i] ?? '';
    }
  });
  return best.slice(0, 120);
}

/** Fatia processada por "respiro" — a thread principal nunca fica presa. */
const CHUNK = 40;
const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Procura um trecho de letra em todas as letras em cache — ASSÍNCRONA e em
 * fatias: alto volume (centenas de letras) é varrido 40 faixas por vez com
 * respiro entre fatias, então nada trava, nem no primeiro scan (que ainda
 * normaliza os textos). O chamador cancela buscas obsoletas via `signal`.
 *  - Exato (normalizado): trecho contido na letra → score alto.
 *  - Fuzzy (voz/erros de digitação): janela deslizante de linhas — conta
 *    quantas palavras da consulta aparecem juntas; exige ≥ 65% de cobertura.
 * Consultas curtas (< 2 palavras úteis ou < 8 caracteres) não contam — "amor"
 * casaria com metade da biblioteca e viraria ruído.
 */
export async function searchByLyrics(
  query: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<LyricMatch[]> {
  const nq = norm(query);
  const tokens = nq.split(' ').filter((w) => w.length >= 2);
  if (nq.length < 8 || tokens.length < 2) return [];

  // A consulta também passa pela grafia padrão ("nois" digitado acha "nós"). Mas
  // a letra pode estar em inglês, onde "memo" é "memo": por isso as DUAS
  // formas são tentadas (a que não ajudar simplesmente não casa).
  const nqCorrigida = norm(corrigirGrafia(query));
  const variantes = [{ nq, tokens }];
  if (nqCorrigida !== nq) {
    variantes.push({
      nq: nqCorrigida,
      tokens: nqCorrigida.split(' ').filter((w) => w.length >= 2),
    });
  }

  const entries = lyricsCacheEntries();
  const results: LyricMatch[] = [];
  let exactHits = 0;

  for (let start = 0; start < entries.length; start += CHUNK) {
    if (signal?.aborted) return [];
    for (const [trackId, lyrics] of entries.slice(start, start + CHUNK)) {
      const indexada = normalizedLyrics(trackId, lyrics);
      const { lines, full } = indexada;
      if (!full) continue;

      let melhor: LyricMatch | null = null;
      for (const v of variantes) {
        // 1. Casamento exato do trecho inteiro.
        if (full.includes(v.nq)) {
          melhor = { trackId, excerpt: bestExcerpt(indexada, v.tokens), score: 100 };
          break;
        }

        // 2. Fuzzy: melhor linha (e vizinha) por cobertura das palavras.
        let bestCoverage = 0;
        for (let i = 0; i < lines.length; i++) {
          const window = i + 1 < lines.length ? `${lines[i]} ${lines[i + 1]}` : lines[i]!;
          let hits = 0;
          for (const t of v.tokens) if (window.includes(t)) hits += 1;
          const coverage = hits / v.tokens.length;
          if (coverage > bestCoverage) bestCoverage = coverage;
          if (bestCoverage === 1) break;
        }
        const score = Math.round(bestCoverage * 90);
        if (bestCoverage >= 0.65 && (!melhor || score > melhor.score)) {
          melhor = { trackId, excerpt: bestExcerpt(indexada, v.tokens), score };
        }
      }
      if (melhor) {
        results.push(melhor);
        if (melhor.score === 100) exactHits += 1;
      }
    }
    // Já achou exatos suficientes → não precisa varrer o resto.
    if (exactHits >= limit) break;
    if (start + CHUNK < entries.length) await yieldToUi();
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

let indexing = false;

/**
 * Completa o cache de letras da biblioteca aos poucos (N faixas por chamada,
 * com pausas — gentil com o LRCLIB). Quanto mais roda, mais faixas ficam
 * encontráveis pela letra, inclusive offline.
 */
export async function indexLyricsInBackground(tracks: TrackDto[], limit = 15): Promise<void> {
  if (indexing || typeof navigator === 'undefined' || !navigator.onLine) return;
  indexing = true;
  try {
    let done = 0;
    for (const track of tracks) {
      if (done >= limit) break;
      if (cachedLyrics(track.id)) continue;
      if (!track.title?.trim()) continue;
      await fetchLyrics(track).catch(() => null);
      done += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } finally {
    indexing = false;
  }
}
