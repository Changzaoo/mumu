/**
 * Apple/iTunes catalog client — the mainstream, real-hits data source. The
 * iTunes public APIs are keyless, CORS-enabled and require no backend, and they
 * expose the ACTUAL popular songs (Drake, The Weeknd, Shakira…) with correct
 * titles/artists/cover art.
 *
 * LEGAL: Apple provides official **30-second preview** clips (`previewUrl`) for
 * every song — these are legal to stream. Full-length copyrighted playback is
 * NOT available and is never attempted. Mapped tracks are stream-only
 * (`downloadUrl: null`, `previewOnly: true`) so they are never downloaded,
 * offline-cached or P2P-shared.
 *
 * Endpoints (all return `Access-Control-Allow-Origin`):
 * - search:  https://itunes.apple.com/search?term=…&entity=song
 * - lookup:  https://itunes.apple.com/lookup?id={csvIds}&entity=song  (charts → previews)
 * - charts:  https://itunes.apple.com/{cc}/rss/topsongs/limit={n}/json (no previewUrl → lookup)
 *
 * Every function returns raw `AppleSong` rows (mapped to `TrackDto` in
 * `mapApple.ts`) and throws the shared `CatalogError` on network failure.
 * Country defaults to `'br'` and falls back to `'us'` on empty results.
 */
import { CatalogError } from '@/lib/catalog/audius';
import { parseLabel } from '@/lib/catalog/label';

/** iTunes Search/Lookup song result row (only the fields we consume). */
export interface AppleSong {
  trackId: number;
  trackName: string;
  artistName: string;
  artistId: number;
  collectionName: string;
  collectionId: number;
  artworkUrl100: string;
  previewUrl: string;
  trackTimeMillis: number;
  trackExplicitness: string;
  primaryGenreName: string;
  /** Compositor(es) — a Apple só devolve para parte do catálogo, daí opcional. */
  composerName?: string;
  /** Gravadora do álbum (lida do `copyright` da coleção — ver `albumTracks`). */
  label?: string | null;
}

const DEFAULT_COUNTRY = 'br';
const FALLBACK_COUNTRY = 'us';

/** Curated subset of Apple genre ids for the home/discover chips. */
export const APPLE_GENRES: ReadonlyArray<{ id: number; label: string }> = [
  { id: 14, label: 'Pop' },
  { id: 18, label: 'Hip-Hop/Rap' },
  { id: 15, label: 'R&B/Soul' },
  { id: 17, label: 'Dance' },
  { id: 7, label: 'Eletrônica' },
  { id: 21, label: 'Rock' },
  { id: 20, label: 'Alternativo' },
  { id: 12, label: 'Latina' },
  { id: 6, label: 'Country' },
  { id: 1332, label: 'Sertanejo' },
  { id: 1122, label: 'MPB' },
  { id: 1123, label: 'Funk' },
] as const;

/** A song result row missing a `previewUrl` cannot be played — drop it. */
function isPlayable(song: Partial<AppleSong>): song is AppleSong {
  return (
    typeof song.trackId === 'number' && typeof song.previewUrl === 'string' && !!song.previewUrl
  );
}

/** iTunes album (collection) row — the fields we show in the discography. */
export interface AppleAlbum {
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100: string;
  releaseDate: string | null;
  trackCount: number | null;
  /** Gravadora, extraída do `copyright` da coleção. */
  label: string | null;
}

const nrm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Resolve an artist NAME to its iTunes artistId (closest name match). */
export async function searchArtistId(name: string): Promise<number | null> {
  const term = name.trim();
  if (!term) return null;
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', term);
  url.searchParams.set('entity', 'musicArtist');
  url.searchParams.set('limit', '8');
  url.searchParams.set('country', DEFAULT_COUNTRY);
  const body = await fetchJson<{ results?: Array<{ artistId?: number; artistName?: string }> }>(
    url.toString(),
  );
  const results = body.results ?? [];
  const want = nrm(term);
  const exact = results.find((r) => r.artistName && nrm(r.artistName) === want);
  return (exact ?? results[0])?.artistId ?? null;
}

/** All albums released by an iTunes artist id (newest first, singles dropped). */
export async function artistAlbums(artistId: number): Promise<AppleAlbum[]> {
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', String(artistId));
  url.searchParams.set('entity', 'album');
  url.searchParams.set('limit', '120');
  url.searchParams.set('country', DEFAULT_COUNTRY);
  const body = await fetchJson<{ results?: Array<Record<string, unknown>> }>(url.toString());
  const rows = (body.results ?? []).filter(
    (r) => r.wrapperType === 'collection' && typeof r.collectionId === 'number',
  );
  return rows.map((r) => ({
    collectionId: r.collectionId as number,
    collectionName: String(r.collectionName ?? 'Álbum'),
    artistName: String(r.artistName ?? ''),
    artworkUrl100: String(r.artworkUrl100 ?? ''),
    releaseDate: typeof r.releaseDate === 'string' ? r.releaseDate : null,
    trackCount: typeof r.trackCount === 'number' ? r.trackCount : null,
    label: parseLabel(typeof r.copyright === 'string' ? r.copyright : null),
  }));
}

/** The song rows of an iTunes album (collectionId), in track order. */
export async function albumTracks(collectionId: number): Promise<AppleSong[]> {
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', String(collectionId));
  url.searchParams.set('entity', 'song');
  url.searchParams.set('country', DEFAULT_COUNTRY);
  const body = await fetchJson<{ results?: Array<Partial<AppleSong> & { copyright?: unknown }> }>(
    url.toString(),
  );
  const rows = body.results ?? [];
  // A gravadora só existe na linha-cabeçalho do álbum (wrapperType=collection),
  // e é ela que carrega o `copyright`. Lemos ali e repassamos para cada faixa —
  // sem isso o dado se perderia junto com o cabeçalho no filtro abaixo.
  const label = parseLabel(
    rows.find((r) => typeof r.copyright === 'string')?.copyright as string | undefined,
  );
  // The first row is the album header (wrapperType=collection) — keep only songs.
  return rows.filter(isPlayable).map((song) => ({ ...song, label }));
}

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  // Apple's CDN echoes the request Origin into Access-Control-Allow-Origin but
  // caches WITHOUT `Vary: Origin`, so a response cached for another origin (e.g.
  // the old aurial.vercel.app) gets served to us with a mismatched ACAO → CORS
  // block. Partition the cache by our own origin so we always get a response
  // whose ACAO matches us. (iTunes ignores unknown query params.)
  try {
    const u = new URL(url);
    if (typeof window !== 'undefined' && window.location?.hostname) {
      u.searchParams.set('_o', window.location.hostname);
    }
    url = u.toString();
  } catch {
    /* leave url as-is */
  }
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new CatalogError('Não foi possível conectar ao catálogo de músicas.', cause);
  }
  if (!res.ok) {
    throw new CatalogError(`Falha ao carregar o catálogo (${res.status}).`);
  }
  try {
    return (await res.json()) as T;
  } catch (cause) {
    throw new CatalogError('Resposta inesperada do catálogo.', cause);
  }
}

interface SearchResponse {
  results?: Array<Partial<AppleSong>>;
}

/** Search real songs by term. Falls back br→us when a country returns nothing. */
export async function searchSongs(
  q: string,
  cc: string = DEFAULT_COUNTRY,
  limit = 25,
): Promise<AppleSong[]> {
  const term = q.trim();
  if (!term) return [];

  const run = async (country: string): Promise<AppleSong[]> => {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', term);
    url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'song');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('country', country);
    const body = await fetchJson<SearchResponse>(url.toString());
    return (body.results ?? []).filter(isPlayable);
  };

  const primary = await run(cc);
  if (primary.length > 0 || cc === FALLBACK_COUNTRY) return primary;
  return run(FALLBACK_COUNTRY);
}

/**
 * Batch lookup by track ids (up to ~180 per call) → full song rows with
 * previewUrl + hi-res art. Order-preserving relative to `ids`.
 */
export async function lookup(ids: number[], cc: string = DEFAULT_COUNTRY): Promise<AppleSong[]> {
  if (ids.length === 0) return [];
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', ids.join(','));
  url.searchParams.set('entity', 'song');
  url.searchParams.set('country', cc);
  const body = await fetchJson<SearchResponse>(url.toString());
  const rows = (body.results ?? []).filter(isPlayable);
  // lookup does not guarantee input order — reindex by trackId.
  const byId = new Map(rows.map((r) => [r.trackId, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is AppleSong => r !== undefined);
}

/** iTunes "top songs" RSS entry (charts carry no previewUrl — see `topSongs`). */
interface RssEntry {
  id?: { attributes?: { 'im:id'?: string } };
}
interface RssResponse {
  feed?: { entry?: RssEntry[] };
}

/** Collect the numeric track ids from a top-songs RSS feed. */
async function chartIds(feedUrl: string): Promise<number[]> {
  const body = await fetchJson<RssResponse>(feedUrl);
  const entries = body.feed?.entry ?? [];
  const ids: number[] = [];
  for (const entry of entries) {
    const raw = entry.id?.attributes?.['im:id'];
    const id = raw ? Number(raw) : NaN;
    if (Number.isFinite(id)) ids.push(id);
  }
  return ids;
}

/** Resolve a top-songs chart (ids → hydrated previews), br→us on empty. */
async function chartToSongs(
  path: (cc: string) => string,
  cc: string,
  limit: number,
): Promise<AppleSong[]> {
  const hydrate = async (country: string): Promise<AppleSong[]> => {
    const ids = await chartIds(path(country));
    if (ids.length === 0) return [];
    const songs = await lookup(ids.slice(0, limit), country);
    return songs.slice(0, limit);
  };

  const primary = await hydrate(cc);
  if (primary.length > 0 || cc === FALLBACK_COUNTRY) return primary;
  return hydrate(FALLBACK_COUNTRY);
}

/** Real "top songs" for a country (the primary Home carousel). */
export async function topSongs(cc: string = DEFAULT_COUNTRY, limit = 40): Promise<AppleSong[]> {
  return chartToSongs(
    (country) => `https://itunes.apple.com/${country}/rss/topsongs/limit=${limit}/json`,
    cc,
    limit,
  );
}

/** Real "top songs" filtered by Apple genre id (see `APPLE_GENRES`). */
export async function topSongsByGenre(
  genreId: number,
  cc: string = DEFAULT_COUNTRY,
  limit = 40,
): Promise<AppleSong[]> {
  return chartToSongs(
    (country) =>
      `https://itunes.apple.com/${country}/rss/topsongs/genre=${genreId}/limit=${limit}/json`,
    cc,
    limit,
  );
}
