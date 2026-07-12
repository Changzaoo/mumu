/**
 * Lyrics — time-synced ("karaoke") lyrics from LRCLIB (free, no key, CORS-open).
 *
 * We look a track up by title/artist/(duration), parse the LRC timestamps into
 * lines, and cache the result in localStorage so downloaded songs keep their
 * lyrics offline. `previewOnly` (30s Apple) tracks search by name only, since
 * their duration won't match the full song.
 */
import type { TrackDto } from '@aurial/shared';

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

function parseLrc(lrc: string): LyricLine[] {
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
    for (const t of times) out.push({ timeMs: t, text });
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

interface LrclibRow {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
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
function readCache(): Record<string, Lyrics> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Lyrics>) : {};
  } catch {
    return {};
  }
}

function writeCache(next: Record<string, Lyrics>): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* quota — ignore */
  }
}

export function cachedLyrics(trackId: string): Lyrics | null {
  return readCache()[trackId] ?? null;
}

// ── fetch ───────────────────────────────────────────────────────
async function lrclibGet(track: TrackDto): Promise<Lyrics | null> {
  const title = track.title.trim();
  const artist = track.artists[0]?.name?.trim();
  const durationSec = track.previewOnly ? 0 : Math.round((track.durationMs || 0) / 1000);

  const get = async (): Promise<Lyrics | null> => {
    if (!durationSec) return null;
    const url = new URL('https://lrclib.net/api/get');
    url.searchParams.set('track_name', title);
    if (artist) url.searchParams.set('artist_name', artist);
    if (track.album?.title) url.searchParams.set('album_name', track.album.title);
    url.searchParams.set('duration', String(durationSec));
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    return res.ok ? toLyrics((await res.json()) as LrclibRow) : null;
  };

  const search = async (): Promise<Lyrics | null> => {
    const url = new URL('https://lrclib.net/api/search');
    url.searchParams.set('track_name', title);
    if (artist) url.searchParams.set('artist_name', artist);
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const rows = (await res.json()) as LrclibRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return toLyrics(rows.find((r) => r.syncedLyrics) ?? rows[0]);
  };

  return (await get()) ?? (await search());
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
    const lyrics = await lrclibGet(track);
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
