/**
 * Lógica PURA da varredura de capas — quem ainda está sem capa, qual resultado
 * do catálogo serve, e quantas vezes já tentamos.
 *
 * Mora fora do localLibrary porque é a parte que dá para testar sozinha (e a
 * que erra caro: aplicar a capa errada é pior que não aplicar nenhuma). O passe
 * que fala com a rede vive no localLibrary, que é quem tem o registro.
 *
 * A memória de tentativas é local (não sincroniza): ela mede o esforço DESTE
 * aparelho, e uma faixa realmente inencontrável precisa parar de custar rede
 * em todo boot — daí o teto de 3 tentativas, com reset manual pelo "tentar de
 * novo".
 */
import type { TrackDto } from '@aurial/shared';

/** Depois de 3 tentativas sem achar, a faixa sai da varredura automática. */
export const MAX_COVER_ATTEMPTS = 3;

/** Teto por sessão — a varredura é enfeite, nunca pode virar carga de rede. */
export const COVER_SWEEP_LIMIT = 30;

/**
 * A chave carrega a VERSÃO da cadeia de busca. Quando a ordem das fontes muda
 * (foi o caso: o Deezer passou à frente do iTunes por medição real, e entrou a
 * miniatura da fonte como último recurso), as tentativas antigas viram
 * história de outro algoritmo — mantê-las deixaria as faixas que já esgotaram
 * o limite congeladas sem capa para sempre, justamente as que a mudança veio
 * salvar. Trocar a versão dá a todo mundo uma chance nova, uma única vez.
 */
const ATTEMPTS_KEY = 'aurial:coverAttempts:v2';

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Comparação frouxa: sem caixa, sem acento, sem pontuação. */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Normalização de NOME DE ARTISTA: além do resto, derruba os conectivos.
 *
 * "Chitãozinho & Xororó" e "Chitaozinho e Xororo" são o MESMO artista, mas o
 * "e" no meio impede qualquer comparação por prefixo/substring — e duplas com
 * conectivo são a regra no catálogo brasileiro. Sem isto a dupla mais tocada do
 * país nunca casava, e ficava sem capa.
 */
const CONNECTORS = new Set(['e', 'and', 'feat', 'ft', 'with', 'com', 'y']);

function normalizeArtistName(value: string): string {
  return normalizeForMatch(value)
    .split(' ')
    .filter((token) => token && !CONNECTORS.has(token))
    .join(' ');
}

/** Uma linha de catálogo reduzida ao que importa para conferir identidade. */
export interface ArtworkCandidate {
  title: string;
  artist: string;
  artworkUrl: string;
}

/**
 * Nota de semelhança (0 = não serve). Título E artista precisam bater: só
 * título casaria "Evidências" de qualquer intérprete, e uma capa errada
 * estampada na biblioteca é pior que o ícone padrão — o usuário acredita nela.
 * Sem artista conhecido aceitamos só título exato, e nada menos.
 */
export function scoreArtworkMatch(
  candidate: ArtworkCandidate,
  wantTitle: string,
  wantArtist?: string | null,
): number {
  if (!candidate.artworkUrl) return 0;
  const t = normalizeForMatch(candidate.title);
  const wt = normalizeForMatch(wantTitle);
  if (!t || !wt) return 0;
  const titleScore = t === wt ? 3 : t.startsWith(wt) || wt.startsWith(t) ? 2 : 0;
  if (titleScore === 0) return 0;

  const wa = wantArtist ? normalizeArtistName(wantArtist) : '';
  if (!wa) return titleScore === 3 ? titleScore : 0; // sem artista, só o exato passa
  const a = normalizeArtistName(candidate.artist);
  if (!a) return 0;
  const artistScore = a === wa ? 3 : a.includes(wa) || wa.includes(a) ? 2 : 0;
  if (artistScore === 0) return 0;
  return titleScore + artistScore;
}

/** A melhor linha do catálogo para esta faixa, ou null se nenhuma convence. */
export function pickArtworkMatch<T extends ArtworkCandidate>(
  rows: readonly T[],
  wantTitle: string,
  wantArtist?: string | null,
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const score = scoreArtworkMatch(row, wantTitle, wantArtist);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best;
}

/**
 * A faixa está sem capa? Roda DEPOIS de restoreEmbeddedCovers, então uma capa
 * embutida já foi reidratada aqui. Um `blob:` que sobrou é URL morta de outra
 * sessão — conta como ausente, senão a faixa nunca mais buscaria a dela.
 */
export function isMissingCover(track: TrackDto): boolean {
  const cover = track.coverUrl;
  return !cover || cover.startsWith('blob:');
}

/** Faltam a ficha técnica (gravadora/compositor) — só a MusicBrainz os tem. */
export function isMissingCredits(track: TrackDto): boolean {
  return !track.label || !track.composer;
}

/** Uma faixa só entra na varredura se um título de busca útil existir. */
export function hasSearchableTitle(track: TrackDto): boolean {
  const t = normalizeForMatch(track.title);
  return t.length > 0 && t !== 'faixa';
}

/**
 * Quem a varredura vai tentar nesta sessão: sem capa, com título buscável e
 * ainda dentro do teto de tentativas — no máximo `limit` por vez.
 */
export function pickBackfillCandidates(
  tracks: readonly TrackDto[],
  attempts: Readonly<Record<string, number>>,
  limit: number = COVER_SWEEP_LIMIT,
): TrackDto[] {
  const out: TrackDto[] = [];
  for (const track of tracks) {
    if (out.length >= limit) break;
    if (!isMissingCover(track)) continue;
    if (!hasSearchableTitle(track)) continue;
    if ((attempts[track.id] ?? 0) >= MAX_COVER_ATTEMPTS) continue;
    out.push(track);
  }
  return out;
}

/** Quantas faixas a varredura ainda pode tentar (a linha "N restantes"). */
export function countPendingCovers(
  tracks: readonly TrackDto[],
  attempts: Readonly<Record<string, number>>,
): number {
  return pickBackfillCandidates(tracks, attempts, Number.POSITIVE_INFINITY).length;
}

// ── memória de tentativas (localStorage, nunca sincronizada) ──────────────────

export function readCoverAttempts(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(ATTEMPTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isFinite(n)) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCoverAttempts(attempts: Record<string, number>): void {
  try {
    window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
  } catch {
    /* cota / modo privado — a varredura só perde a memória entre sessões */
  }
}

/** Marca uma tentativa (some do controle assim que a capa é encontrada). */
export function bumpCoverAttempt(id: string, found: boolean): void {
  const attempts = readCoverAttempts();
  if (found) delete attempts[id];
  else attempts[id] = (attempts[id] ?? 0) + 1;
  writeCoverAttempts(attempts);
}

/** "Tentar de novo": devolve as desistidas para a fila da próxima varredura. */
export function resetCoverAttempts(): void {
  writeCoverAttempts({});
}
