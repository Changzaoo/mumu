/**
 * Audius catalog client — the client-side data source for real, legal, freely
 * playable music (Audius public API, no key). The central Aurial backend is not
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
import type { ArtistDto, TrackDto } from '@aurial/shared';

const APP_NAME = 'Aurial';
const HOST_KEY = 'aurial:audius-host';
const FALLBACK_HOST = 'https://discoveryprovider.audius.co';

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
    const res = await fetch('https://api.audius.co');
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
    res = await fetch(url.toString());
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
