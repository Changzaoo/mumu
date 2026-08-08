/**
 * Real artist photos, cached. Looks a name up once (via the importer → Deezer),
 * caches the result in localStorage (url or null), and notifies subscribers so
 * artist cards fill in their picture when it arrives. Falling back to a track
 * cover is the caller's job when this returns null.
 */
import { useSyncExternalStore } from 'react';
import { fetchArtistImage } from '@/lib/local/importerHelper';
import { gravarCache, registrarDescartavel } from '@/lib/local/cofreLocal';

/**
 * A CHAVE CARREGA VERSÃO — e sem isso o conserto não chegaria em ninguém.
 *
 * O cache guarda "nome → url" e nunca reconfere: uma vez gravada, a foto fica
 * para sempre, inclusive quando é a pessoa errada. Foi o que aconteceu — o
 * Drake ficou com o rosto do Ice Cube porque a busca antiga pegava o primeiro
 * resultado do Deezer sem conferir o nome (ver `/artist-image` no importer).
 *
 * Consertar a busca não bastaria: o aparelho continuaria mostrando o que já
 * está guardado. Subir o número aqui aposenta o cache inteiro de uma vez, e
 * cada foto é buscada de novo pela regra nova. Suba de novo se a regra de
 * correspondência mudar outra vez.
 */
const CACHE_KEY = 'aurial:artist-images:v2';
const CHAVE_ANTIGA = 'aurial:artist-images';

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
    // O cache velho some junto: deixá-lo ali só ocuparia espaço no
    // localStorage, que é justamente o recurso mais apertado do app.
    window.localStorage.removeItem(CHAVE_ANTIGA);
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
  gravarCache(CACHE_KEY, JSON.stringify(next), 200_000); // ver lib/local/cofreLocal.ts
  emit();
}

registrarDescartavel(CACHE_KEY, 30, () => {
  cache = null;
});

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
