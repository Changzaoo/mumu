/**
 * Lyrics — time-synced ("karaoke") lyrics from LRCLIB (free, no key, CORS-open).
 *
 * We look a track up by title/artist/(duration), parse the LRC timestamps into
 * lines, and cache the result in localStorage so downloaded songs keep their
 * lyrics offline. `previewOnly` (30s Apple) tracks search by name only, since
 * their duration won't match the full song.
 */
import type { TrackDto } from '@aurial/shared';
import { aiCleanSongTitle } from '@/lib/ai/ai';

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
  source: string | null;
}

const CACHE_KEY = 'aurial:lyrics-cache';
const LRC_TIME = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LRC_OFFSET = /\[offset:\s*([+-]?\d+)\s*\]/i;

function parseLrc(lrc: string): LyricLine[] {
  // `[offset:±ms]` é um deslocamento global do arquivo; convenção dos players:
  // tempo efetivo = tempo - offset (positivo adianta a letra). Ignorá-lo deixa
  // TODAS as linhas fora de sincronia por esse valor fixo.
  const offset = Number(LRC_OFFSET.exec(lrc)?.[1] ?? 0) || 0;
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    LRC_TIME.lastIndex = 0;
    const times: number[] = [];
    let match: RegExpExecArray | null;
    let end = 0;
    while ((match = LRC_TIME.exec(raw)) !== null) {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const frac = match[3] ? Number((match[3] + '000').slice(0, 3)) : 0;
      times.push((min * 60 + sec) * 1000 + frac);
      end = LRC_TIME.lastIndex;
    }
    if (times.length === 0) continue;
    const text = raw.slice(end).trim();
    for (const t of times) out.push({ timeMs: Math.max(0, t - offset), text });
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

interface LrclibRow {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  trackName?: string | null;
  artistName?: string | null;
  duration?: number | null;
}

/** Loose normalization for fuzzy title/artist comparison. */
function normLoose(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * True when a fuzzy `/api/search` row plausibly IS this track — the search
 * endpoint is loose full-text and returns many unrelated songs, so accepting
 * the first row with synced lyrics is exactly how WRONG lyrics get locked in.
 * Guard on title similarity + artist overlap + duration proximity.
 */
function rowMatches(row: LrclibRow, title: string, names: string[], durationSec: number): boolean {
  const rt = normLoose(row.trackName ?? '');
  const qt = normLoose(title);
  if (!rt || !qt) return false;
  const titleOk = rt === qt || rt.includes(qt) || qt.includes(rt);
  if (!titleOk) return false;
  const ra = normLoose(row.artistName ?? '');
  const artistOk =
    names.length === 0 ||
    !ra ||
    names.some((n) => {
      const nn = normLoose(n);
      return nn.length > 0 && (ra.includes(nn) || nn.includes(ra));
    });
  if (!artistOk) return false;
  // Sem duração de referência (preview) não dá pra checar; título+artista bastam.
  const durOk = !durationSec || !row.duration || Math.abs(row.duration - durationSec) <= 3;
  return durOk;
}

function toLyrics(row: LrclibRow | null | undefined): Lyrics | null {
  if (!row) return null;
  if (typeof row.syncedLyrics === 'string' && row.syncedLyrics.trim()) {
    const lines = parseLrc(row.syncedLyrics);
    if (lines.length > 0) return { synced: true, lines, source: 'LRCLIB' };
  }
  if (typeof row.plainLyrics === 'string' && row.plainLyrics.trim()) {
    const lines = row.plainLyrics.split(/\r?\n/).map((text) => ({ timeMs: 0, text: text.trim() }));
    return { synced: false, lines, source: 'LRCLIB' };
  }
  return null;
}

// ── offline cache ───────────────────────────────────────────────
// MEMOIZADO: o cache de letras chega a megabytes — fazer JSON.parse a cada
// consulta (a busca por letra roda a cada tecla!) congelaria a página. O parse
// acontece UMA vez; escrever atualiza a memória primeiro.
let cacheMem: Record<string, Lyrics> | null = null;

function readCache(): Record<string, Lyrics> {
  if (cacheMem) return cacheMem;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cacheMem = parsed && typeof parsed === 'object' ? (parsed as Record<string, Lyrics>) : {};
  } catch {
    cacheMem = {};
  }
  return cacheMem;
}

function writeCache(next: Record<string, Lyrics>): void {
  cacheMem = next;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* quota — ignore */
  }
}

export function cachedLyrics(trackId: string): Lyrics | null {
  return readCache()[trackId] ?? null;
}

/** Todas as letras em cache — combustível da busca por trecho de letra. */
export function lyricsCacheEntries(): Array<[string, Lyrics]> {
  return Object.entries(readCache());
}

// ── fetch ───────────────────────────────────────────────────────

/** Strip parentheticals / feat / live-remaster noise that hurts LRCLIB matching. */
function cleanTitleForLyrics(title: string): string {
  return title
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ') // (feat …), [Official Video]
    .replace(/\s*[-–—]\s*(?:ao\s+vivo|live|remaster(?:ed)?.*|slowed.*|sped\s*up.*)$/i, ' ')
    .replace(/\bfeat\.?\b.*$|\bft\.?\b.*$/i, ' ') // trailing "feat X" without parens
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function lrclibGet(track: TrackDto): Promise<Lyrics | null> {
  const rawTitle = track.title.trim();
  const cleanTitle = cleanTitleForLyrics(rawTitle) || rawTitle;
  const durationSec = track.previewOnly ? 0 : Math.round((track.durationMs || 0) / 1000);

  // Try every distinct artist on the track (a two-artist song matches on either),
  // then no-artist. Distinct, order-preserving, non-empty.
  const names = Array.from(
    new Set(track.artists.map((a) => a.name?.trim()).filter((a): a is string => Boolean(a))),
  )
    .filter((a) => a !== 'Desconhecido')
    .slice(0, 2); // cap tries so we stay polite to LRCLIB
  const artistCandidates: Array<string | undefined> = [...names, undefined];
  const titleCandidates = Array.from(new Set([cleanTitle, rawTitle].filter(Boolean)));

  const get = async (title: string, artist: string | undefined): Promise<Lyrics | null> => {
    if (!durationSec) return null;
    const url = new URL('https://lrclib.net/api/get');
    url.searchParams.set('track_name', title);
    if (artist) url.searchParams.set('artist_name', artist);
    if (track.album?.title) url.searchParams.set('album_name', track.album.title);
    url.searchParams.set('duration', String(durationSec));
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    return res.ok ? toLyrics((await res.json()) as LrclibRow) : null;
  };

  // Exact get() across title × artist candidates — prefer a synced hit.
  let plainFallback: Lyrics | null = null;
  for (const title of titleCandidates) {
    for (const artist of artistCandidates) {
      const found = await get(title, artist).catch(() => null);
      if (found?.synced) return found;
      if (found && !plainFallback) plainFallback = found;
    }
  }

  // Fuzzy search — pick the best SYNCED row (compare title + any artist).
  const search = async (title: string, artist: string | undefined): Promise<LrclibRow[] | null> => {
    const url = new URL('https://lrclib.net/api/search');
    url.searchParams.set('track_name', title);
    if (artist) url.searchParams.set('artist_name', artist);
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const rows = (await res.json()) as LrclibRow[];
    return Array.isArray(rows) ? rows : null;
  };

  for (const title of titleCandidates) {
    for (const artist of artistCandidates) {
      const rows = await search(title, artist).catch(() => null);
      if (!rows || rows.length === 0) continue;
      // Só aceita uma linha que REALMENTE bate com a faixa (título+artista+
      // duração) — a busca é full-text solta e devolve músicas alheias.
      const synced = rows.find((r) => r.syncedLyrics && rowMatches(r, title, names, durationSec));
      if (synced) return toLyrics(synced);
      const plain = rows.find((r) => rowMatches(r, title, names, durationSec));
      if (plain && !plainFallback) plainFallback = toLyrics(plain);
    }
  }

  return plainFallback;
}

/**
 * Resolve lyrics for a track: cache → LRCLIB. Never throws; returns null when
 * nothing is found. Successful results are cached for offline reuse.
 */
export async function fetchLyrics(track: TrackDto): Promise<Lyrics | null> {
  const cached = cachedLyrics(track.id);
  if (cached) return cached;
  if (!track.title?.trim()) return null;
  try {
    let lyrics = await lrclibGet(track);
    // Fallback: let the AI parse a clean artist/title and retry once.
    if (!lyrics) {
      const cleaned = await aiCleanSongTitle(track.title, track.artists[0]?.name);
      if (cleaned && (cleaned.title !== track.title || cleaned.artist)) {
        const a0 = track.artists[0];
        lyrics = await lrclibGet({
          ...track,
          title: cleaned.title,
          artists: cleaned.artist
            ? [{ id: a0?.id ?? 'ai', name: cleaned.artist, slug: a0?.slug ?? '', imageUrl: null }]
            : track.artists,
        });
      }
    }
    if (lyrics) writeCache({ ...readCache(), [track.id]: lyrics });
    return lyrics;
  } catch {
    return null;
  }
}

/** Fire-and-forget prefetch (e.g. at download time) so lyrics are ready offline. */
export function prefetchLyrics(track: TrackDto): void {
  if (cachedLyrics(track.id)) return;
  void fetchLyrics(track).catch(() => undefined);
}
