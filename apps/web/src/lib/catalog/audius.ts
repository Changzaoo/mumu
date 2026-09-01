/**
 * Audius catalog client — the client-side data source for real, legal, freely
 * playable music (Audius public API, no key). The central radinho.online backend is not
 * deployed in the P2P topology, so Home / Search / Discover read from here.
 *
 * Host discovery: `GET https://api.audius.co` → `{ data: string[] }`. We pick a
 * node, cache it (in-memory + localStorage) for the session, and append
 * `?app_name=Aurial` to every request. Every function returns mapped domain
 * objects and throws a typed `CatalogError` on any failure.
 */
import {
  audiusPlaylistToCatalog,
  audiusTrackToDto,
  audiusUserToArtist,
  type AudiusPlaylist,
  type AudiusTrack,
  type AudiusUser,
  type CatalogPlaylist,
} from '@/lib/catalog/map';
import type { ArtistDto, TrackDto } from '@radinho/shared';

const APP_NAME = 'Aurial';
const HOST_KEY = 'aurial:audius-host';
const FALLBACK_HOST = 'https://discoveryprovider.audius.co';
// Nó de descoberta morto pode não devolver erro nenhum — só pendurar a conexão
// sem soltar bytes. Sem teto aqui, `fetch` nunca rejeita, o watchdog de rede
// não existe para chamadas de catálogo, e a UI trava esperando para sempre em
// vez de rotacionar para outro nó. 8s cobre um nó lento de verdade sem deixar
// quem clica numa faixa morta esperando eternamente por um "indisponível".
const FETCH_TIMEOUT_MS = 8_000;

/** `fetch` com teto — nó de descoberta que só pendura vira falha, não trava. */
function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

export class CatalogError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'CatalogError';
  }
}

let cachedHost: string | null = null;

/** Synchronous best-effort host (falls back before discovery resolves). */
export function audiusHost(): string {
  if (cachedHost) return cachedHost;
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(HOST_KEY) : null;
    if (stored) cachedHost = stored;
  } catch {
    /* storage unavailable */
  }
  return cachedHost ?? FALLBACK_HOST;
}

/** Resolve (and cache) a discovery node base URL for the session. */
export async function getHost(): Promise<string> {
  if (cachedHost) return cachedHost;
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(HOST_KEY) : null;
    if (stored) {
      cachedHost = stored;
      return stored;
    }
  } catch {
    /* storage unavailable */
  }

  try {
    const res = await fetchWithTimeout('https://api.audius.co');
    if (res.ok) {
      const body = (await res.json()) as { data?: string[] };
      const host = body.data?.[0];
      if (host) {
        cachedHost = host.replace(/\/$/, '');
        try {
          localStorage.setItem(HOST_KEY, cachedHost);
        } catch {
          /* storage unavailable */
        }
        return cachedHost;
      }
    }
  } catch {
    /* discovery unreachable — use fallback */
  }

  cachedHost = FALLBACK_HOST;
  return cachedHost;
}

/**
 * Lista de nós de descoberta (cacheada na sessão) para rotacionar quando o nó
 * atual falha. Sem isso, UM nó fora do ar torna TODAS as faixas do catálogo
 * "indisponíveis", já que a streamUrl é gravada no DTO com o host da vez.
 */
let hostListPromise: Promise<string[]> | null = null;

function fetchHostList(): Promise<string[]> {
  return (hostListPromise ??= (async () => {
    try {
      const res = await fetchWithTimeout('https://api.audius.co');
      if (!res.ok) return [];
      const body = (await res.json()) as { data?: string[] };
      return (body.data ?? []).map((h) => h.replace(/\/$/, ''));
    } catch {
      return [];
    }
  })());
}

/**
 * Próximo nó de descoberta ainda não descartado nesta tentativa. Promove o nó
 * escolhido a host da sessão para que as PRÓXIMAS faixas já nasçam apontando
 * para um nó vivo.
 */
export async function nextAudiusHost(triedHosts: Iterable<string>): Promise<string | null> {
  const tried = new Set(triedHosts);
  const hosts = await fetchHostList();
  const candidate =
    hosts.find((h) => !tried.has(h) && h !== cachedHost) ??
    (tried.has(FALLBACK_HOST) || cachedHost === FALLBACK_HOST ? null : FALLBACK_HOST);
  if (!candidate) return null;
  cachedHost = candidate;
  try {
    localStorage.setItem(HOST_KEY, candidate);
  } catch {
    /* storage unavailable */
  }
  return candidate;
}

type QueryParams = Record<string, string | number | undefined>;

async function fetchData<T>(path: string, params: QueryParams = {}): Promise<T> {
  const host = await getHost();
  const url = new URL(`${host}/v1${path}`);
  url.searchParams.set('app_name', APP_NAME);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(url.toString());
  } catch (cause) {
    throw new CatalogError('Não foi possível conectar ao catálogo de músicas.', cause);
  }
  if (!res.ok) {
    throw new CatalogError(`Falha ao carregar o catálogo (${res.status}).`);
  }

  let body: { data?: T } | null = null;
  try {
    body = (await res.json()) as { data?: T };
  } catch (cause) {
    throw new CatalogError('Resposta inesperada do catálogo.', cause);
  }
  if (!body || body.data === undefined) {
    throw new CatalogError('Resposta inesperada do catálogo.');
  }
  return body.data;
}

export interface TrendingOptions {
  genre?: string;
  time?: 'week' | 'month' | 'year' | 'allTime';
}

export async function trending(opts: TrendingOptions = {}): Promise<TrackDto[]> {
  const data = await fetchData<AudiusTrack[]>('/tracks/trending', {
    genre: opts.genre,
    time: opts.time,
  });
  return data.map(audiusTrackToDto);
}

export async function searchTracks(q: string): Promise<TrackDto[]> {
  const data = await fetchData<AudiusTrack[]>('/tracks/search', { query: q });
  return data.map(audiusTrackToDto);
}

export async function trendingPlaylists(): Promise<CatalogPlaylist[]> {
  const data = await fetchData<AudiusPlaylist[]>('/playlists/trending');
  return data.map(audiusPlaylistToCatalog);
}

export async function playlist(id: string): Promise<CatalogPlaylist | null> {
  const data = await fetchData<AudiusPlaylist[]>(`/playlists/${id}`);
  const first = data[0];
  return first ? audiusPlaylistToCatalog(first) : null;
}

export async function playlistTracks(id: string): Promise<TrackDto[]> {
  const data = await fetchData<AudiusTrack[]>(`/playlists/${id}/tracks`);
  return data.map(audiusTrackToDto);
}

export async function searchUsers(q: string): Promise<ArtistDto[]> {
  const data = await fetchData<AudiusUser[]>('/users/search', { query: q });
  return data.map(audiusUserToArtist);
}

export async function userTracks(id: string): Promise<TrackDto[]> {
  const data = await fetchData<AudiusTrack[]>(`/users/${id}/tracks`);
  return data.map(audiusTrackToDto);
}

/** Common Audius genres for the discover/home genre chips. */
export const CATALOG_GENRES = [
  'Electronic',
  'Hip-Hop/Rap',
  'Rock',
  'Pop',
  'Lo-Fi',
  'House',
  'Techno',
  'Ambient',
  'Jazz',
  'R&B/Soul',
  'Deep House',
  'Dubstep',
  'Drum & Bass',
  'World',
  'Classical',
] as const;
