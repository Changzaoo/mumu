import { useSyncExternalStore } from 'react';
import type { TrackDto } from '@aurial/shared';
import { fetchArtistTop } from '@/lib/local/importerHelper';
import { normTitle } from '@/lib/artistTop';

const CACHE_KEY = 'aurial:label-top';
const TTL_MS = 7 * 24 * 60 * 60_000;

interface CachedLabelTop {
  scoreByKey: Record<string, number>;
  artists: number;
  at: number;
}

type Cache = Record<string, CachedLabelTop>;

let cache: Cache | null = null;
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function read(): Cache {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' ? (parsed as Cache) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Cache): void {
  cache = next;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const norm = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const trackKey = (artist: string, title: string): string => `${norm(artist)}|${normTitle(title)}`;

async function buildLabelRanking(
  label: string,
  tracks: TrackDto[],
): Promise<CachedLabelTop | null> {
  const artists = [
    ...new Set(tracks.map((t) => t.artists[0]?.name?.trim()).filter(Boolean) as string[]),
  ];
  const capped = artists.slice(0, 12);
  if (capped.length === 0) return null;
  const tops = await Promise.all(capped.map((name) => fetchArtistTop(name)));
  const scoreByKey: Record<string, number> = {};
  tops.forEach((top, index) => {
    const artist = capped[index];
    if (!top || !artist) return;
    top.tracks.forEach((row, position) => {
      const score = Math.max(0, 120 - position * 6);
      const key = trackKey(artist, row.title);
      if (!key.endsWith('|')) scoreByKey[key] = Math.max(scoreByKey[key] ?? 0, score);
    });
  });
  if (Object.keys(scoreByKey).length === 0) return null;
  return { scoreByKey, artists: capped.length, at: Date.now() };
}

function lookup(label: string, tracks: TrackDto[]): CachedLabelTop | null {
  const key = norm(label);
  if (!key) return null;
  const hit = read()[key];
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  if (!inflight.has(key)) {
    inflight.add(key);
    void buildLabelRanking(label, tracks)
      .then((built) => {
        if (!built) return;
        write({ ...read(), [key]: built });
      })
      .catch(() => undefined)
      .finally(() => inflight.delete(key));
  }
  return hit ?? null;
}

export function useLabelTopTracks(
  label: string,
  tracks: TrackDto[],
): { tracks: TrackDto[]; ranked: boolean; rankedArtists: number } {
  useSyncExternalStore(subscribe, () => read()[norm(label)]?.at ?? 0);
  const rank = lookup(label, tracks);
  if (!rank) return { tracks, ranked: false, rankedArtists: 0 };
  const out = tracks
    .map((track, index) => ({
      track,
      index,
      score: rank.scoreByKey[trackKey(track.artists[0]?.name ?? '', track.title)] ?? -1,
    }))
    .sort((a, b) => (a.score === b.score ? a.index - b.index : b.score - a.score))
    .map((row) => row.track);
  return { tracks: out, ranked: true, rankedArtists: rank.artists };
}
