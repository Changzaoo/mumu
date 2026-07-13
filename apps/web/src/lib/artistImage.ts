/**
 * Real artist photos, cached. Looks a name up once (via the importer → Deezer),
 * caches the result in localStorage (url or null), and notifies subscribers so
 * artist cards fill in their picture when it arrives. Falling back to a track
 * cover is the caller's job when this returns null.
 */
import { useSyncExternalStore } from 'react';
import { fetchArtistImage } from '@/lib/local/importerHelper';

const CACHE_KEY = 'aurial:artist-images';

type Cache = Record<string, string | null>; // normalized name → url (null = looked up, none found)

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

const normKey = (name: string): string => name.trim().toLowerCase();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The cached artist photo URL, or null. On a cache miss it kicks off a one-time
 * lookup and returns null now; subscribers re-render when it resolves.
 */
export function artistImage(name: string): string | null {
  const key = normKey(name);
  if (!key) return null;
  const map = read();
  if (key in map) return map[key] ?? null;
  if (!inflight.has(key)) {
    inflight.add(key);
    void fetchArtistImage(name)
      .then((url) => write({ ...read(), [key]: url }))
      .catch(() => write({ ...read(), [key]: null }))
      .finally(() => inflight.delete(key));
  }
  return null;
}

/** React hook: the artist's real photo (or null while it loads / if none). */
export function useArtistImage(name: string): string | null {
  useSyncExternalStore(subscribe, () => read()[normKey(name)] ?? null);
  return artistImage(name);
}
