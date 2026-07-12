/**
 * Song credits from MusicBrainz (free, CORS-open, authoritative). We surface
 * performers (incl. features), composers, lyricists and producers — only what
 * MusicBrainz actually has, never guessed. Cached in localStorage.
 *
 * MusicBrainz coverage of writer credits is uneven, so results can be sparse;
 * that's fine — we prefer "accurate but incomplete" over "full but wrong".
 */
import type { TrackDto } from '@aurial/shared';

export interface Credits {
  performers: string[];
  composers: string[];
  lyricists: string[];
  producers: string[];
  source: string | null;
}

const CACHE_KEY = 'aurial:credits-cache';
const MB = 'https://musicbrainz.org/ws/2';

interface MbArtistRef {
  name?: string;
  artist?: { name?: string };
}
interface MbRelation {
  type?: string;
  artist?: { name?: string };
  work?: { id?: string };
}
interface MbRecording {
  id?: string;
  ['artist-credit']?: MbArtistRef[];
  relations?: MbRelation[];
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function readCache(): Record<string, Credits> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Credits>) : {};
  } catch {
    return {};
  }
}

function writeCache(next: Record<string, Credits>): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* quota — ignore */
  }
}

export function cachedCredits(trackId: string): Credits | null {
  return readCache()[trackId] ?? null;
}

async function mb<T>(path: string): Promise<T | null> {
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${MB}${path}${sep}fmt=json`, {
      headers: { Accept: 'application/json' },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Featured artists parsed straight from the title (reliable). */
function featuredFromTitle(title: string): string[] {
  const m = /(?:feat\.?|ft\.?|featuring|part\.?)\s*\.?\s*([^)\]]+)[)\]]?\s*$/i.exec(title);
  if (!m?.[1]) return [];
  return m[1]
    .split(/\s*(?:,|&|\+|\/|\band\b|\be\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export async function fetchCredits(track: TrackDto): Promise<Credits | null> {
  const cached = cachedCredits(track.id);
  if (cached) return cached;

  const title = track.title?.trim();
  const artist = track.artists[0]?.name?.trim();
  if (!title || !artist) return null;

  const performers = new Set<string>([artist, ...featuredFromTitle(title)]);
  const composers = new Set<string>();
  const lyricists = new Set<string>();
  const producers = new Set<string>();
  const add = (set: Set<string>, name?: string): void => {
    if (name && name.trim()) set.add(name.trim());
  };

  const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
  const search = await mb<{ recordings?: MbRecording[] }>(`/recording/?query=${q}&limit=5`);
  const recs = search?.recordings ?? [];
  const wantA = norm(artist);
  const rec =
    recs.find((r) =>
      (r['artist-credit'] ?? []).some((ac) => {
        const n = norm(ac.name ?? ac.artist?.name ?? '');
        return n && (n.includes(wantA) || wantA.includes(n));
      }),
    ) ?? recs[0];

  if (rec?.id) {
    for (const ac of rec['artist-credit'] ?? []) add(performers, ac.name ?? ac.artist?.name);
    const detail = await mb<MbRecording>(`/recording/${rec.id}?inc=artist-rels+work-rels`);
    for (const r of detail?.relations ?? []) {
      const name = r.artist?.name;
      if (name) {
        if (r.type === 'producer') add(producers, name);
        else if (r.type === 'composer' || r.type === 'writer') add(composers, name);
        else if (r.type === 'lyricist') add(lyricists, name);
        else if (r.type && ['vocal', 'performer', 'instrument'].includes(r.type))
          add(performers, name);
      }
      if (r.type === 'performance' && r.work?.id) {
        const work = await mb<{ relations?: MbRelation[] }>(`/work/${r.work.id}?inc=artist-rels`);
        for (const wr of work?.relations ?? []) {
          const n = wr.artist?.name;
          if (!n) continue;
          if (wr.type === 'composer' || wr.type === 'writer') add(composers, n);
          else if (wr.type === 'lyricist') add(lyricists, n);
        }
      }
    }
  }

  const credits: Credits = {
    performers: [...performers],
    composers: [...composers],
    lyricists: [...lyricists],
    producers: [...producers],
    source: 'MusicBrainz',
  };
  writeCache({ ...readCache(), [track.id]: credits }); // cache to avoid refetching
  return credits;
}
