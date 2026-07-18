/**
 * Biografia real do artista, em cache.
 *
 * A Wikipedia REST é a única fonte boa que não pede chave e manda CORS aberto,
 * então dá para chamar direto do navegador (nenhum token nosso viaja para lá —
 * é uma requisição anônima a um host de terceiro). Tenta pt primeiro, cai para
 * en: artista brasileiro quase sempre tem verbete em pt, internacional nem
 * sempre.
 *
 * O risco desta fonte é homônimo: "Fresno" é uma cidade, "Skank" é um gênero.
 * Uma bio da pessoa errada é PIOR que nenhuma, então o resumo só é aceito
 * quando o próprio texto diz que aquilo é música. Guarda no localStorage para
 * funcionar offline e não repetir a busca a cada visita.
 */
import { useSyncExternalStore } from 'react';

const CACHE_KEY = 'aurial:artist-bios';
// Verbete de artista muda pouco; 30 dias evita refetch sem congelar para sempre.
const TTL_MS = 30 * 24 * 60 * 60_000;
const TIMEOUT_MS = 6_000;

/** Idiomas na ordem de preferência (acervo é majoritariamente brasileiro). */
const LANGS = ['pt', 'en'] as const;

/**
 * Radicais longos o bastante para valerem como prefixo — "music…" só aparece em
 * palavra de música, "cantor…" idem.
 */
const MUSIC_STEM =
  /\b(music|cantor|cantautor|composit|instrumentist|guitarrist|baterist|baixist|rapper|songwriter|sertanej|discograf|banda|bandas)/;

/**
 * Palavras curtas e ambíguas: só valem INTEIRAS. Sem o `\b` final, "pop" casava
 * com "populosa" e a cidade de Fresno passava por banda — exatamente o
 * homônimo que esta checagem existe para barrar.
 */
const MUSIC_WORD =
  /\b(pop|rock|rap|jazz|dj|samba|pagode|funk|blues|reggae|duo|band|bands|singer|musician|album|albuns|albums|hip hop|grupo musical|produtor musical|record producer)\b/;

/** Texto sem acento e em minúsculas — `\b` do JS só entende ASCII. */
const flatten = (value: string): string => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface ArtistBio {
  text: string;
  /** Título do verbete + idioma — o crédito visível ("Wikipédia (pt)"). */
  title: string;
  lang: string;
  url: string | null;
}

interface CachedBio {
  bio: ArtistBio | null;
  at: number;
}

type Cache = Record<string, CachedBio>;

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

/** True quando o texto prova que o verbete fala de música (anti-homônimo). */
export function looksMusical(...parts: Array<string | null | undefined>): boolean {
  const text = flatten(parts.filter(Boolean).join(' '));
  return MUSIC_STEM.test(text) || MUSIC_WORD.test(text);
}

/** GET com teto de tempo — busca de bio nunca pode pendurar a página. */
async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface Summary {
  type?: string;
  title?: string;
  extract?: string;
  description?: string;
  content_urls?: { desktop?: { page?: string } };
}

/** O resumo de um verbete, já validado como sendo de música. */
async function summaryOf(lang: string, title: string): Promise<ArtistBio | null> {
  const data = await getJson<Summary>(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  );
  const text = typeof data?.extract === 'string' ? data.extract.trim() : '';
  // Desambiguação lista vários homônimos — nunca é a bio de ninguém.
  if (!text || data?.type === 'disambiguation') return null;
  if (!looksMusical(text, data?.description)) return null;
  return {
    text,
    title: typeof data?.title === 'string' ? data.title : title,
    lang,
    url: data?.content_urls?.desktop?.page ?? null,
  };
}

interface SearchResponse {
  query?: { search?: Array<{ title?: string }> };
}

/**
 * Busca o verbete certo num idioma: o nome cru raramente é o título exato
 * ("Anitta" é, "Racionais" não), então a busca resolve o apelido e testamos os
 * primeiros candidatos até um passar no teste de "é música".
 */
async function bioIn(lang: string, name: string): Promise<ArtistBio | null> {
  const direct = await summaryOf(lang, name);
  if (direct) return direct;

  const search = await getJson<SearchResponse>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      `${name} música`,
    )}&srlimit=5&format=json&origin=*`,
  );
  const hits = (search?.query?.search ?? [])
    .map((h) => h.title)
    .filter((t): t is string => typeof t === 'string');
  for (const title of hits) {
    const bio = await summaryOf(lang, title);
    if (bio) return bio;
  }
  return null;
}

/** A bio do artista: pt primeiro, en como reserva. null quando não achou. */
export async function fetchArtistBio(name: string): Promise<ArtistBio | null> {
  for (const lang of LANGS) {
    const bio = await bioIn(lang, name);
    if (bio) return bio;
  }
  return null;
}

/**
 * Hook: a bio do artista (null enquanto carrega ou quando não existe). Um
 * "não achou" também é cacheado — repetir a busca a cada render seria custo
 * garantido para o mesmo nada.
 */
export function useArtistBio(name: string): ArtistBio | null {
  useSyncExternalStore(subscribe, () => read()[normKey(name)]?.at ?? 0);
  const key = normKey(name);
  if (!key) return null;
  const hit = read()[key];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bio;
  if (!inflight.has(key)) {
    inflight.add(key);
    void fetchArtistBio(name)
      .then((bio) => write({ ...read(), [key]: { bio, at: Date.now() } }))
      .catch(() => write({ ...read(), [key]: { bio: null, at: Date.now() } }))
      .finally(() => inflight.delete(key));
  }
  return hit?.bio ?? null;
}
