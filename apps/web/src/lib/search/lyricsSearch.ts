/**
 * Busca por TRECHO DE LETRA — digitado ou falado no microfone (a transcrição
 * de voz chega imperfeita, então além do casamento exato há um fuzzy por
 * cobertura de palavras). Fonte: o cache local de letras (LRCLIB) que o app já
 * alimenta ao baixar/enriquecer faixas; um indexador em segundo plano
 * (indexLyricsInBackground) vai completando o cache da biblioteca aos poucos.
 */
import type { TrackDto } from '@aurial/shared';
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
const normalizedCache = new Map<string, { lineCount: number; lines: string[]; full: string }>();

function normalizedLyrics(trackId: string, lyrics: Lyrics): { lines: string[]; full: string } {
  const cached = normalizedCache.get(trackId);
  if (cached && cached.lineCount === lyrics.lines.length) return cached;
  const lines = lyrics.lines.map((l) => norm(l.text)).filter(Boolean);
  const entry = { lineCount: lyrics.lines.length, lines, full: lines.join(' ') };
  normalizedCache.set(trackId, entry);
  return entry;
}

/** Linha original mais próxima do trecho — vira o excerpt exibido. */
function bestExcerpt(lyrics: Lyrics, tokens: string[]): string {
  let best = '';
  let bestHits = 0;
  for (const line of lyrics.lines) {
    if (!line.text) continue;
    const nline = norm(line.text);
    let hits = 0;
    for (const t of tokens) if (nline.includes(t)) hits += 1;
    if (hits > bestHits) {
      bestHits = hits;
      best = line.text;
    }
  }
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

  const entries = lyricsCacheEntries();
  const results: LyricMatch[] = [];
  let exactHits = 0;

  for (let start = 0; start < entries.length; start += CHUNK) {
    if (signal?.aborted) return [];
    for (const [trackId, lyrics] of entries.slice(start, start + CHUNK)) {
      const { lines, full } = normalizedLyrics(trackId, lyrics);
      if (!full) continue;

      // 1. Casamento exato do trecho inteiro.
      if (full.includes(nq)) {
        results.push({ trackId, excerpt: bestExcerpt(lyrics, tokens), score: 100 });
        exactHits += 1;
        continue;
      }

      // 2. Fuzzy: melhor linha (e vizinha) por cobertura das palavras.
      let bestCoverage = 0;
      for (let i = 0; i < lines.length; i++) {
        const window = i + 1 < lines.length ? `${lines[i]} ${lines[i + 1]}` : lines[i]!;
        let hits = 0;
        for (const t of tokens) if (window.includes(t)) hits += 1;
        const coverage = hits / tokens.length;
        if (coverage > bestCoverage) bestCoverage = coverage;
        if (bestCoverage === 1) break;
      }
      if (bestCoverage >= 0.65) {
        results.push({
          trackId,
          excerpt: bestExcerpt(lyrics, tokens),
          score: Math.round(bestCoverage * 90),
        });
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
