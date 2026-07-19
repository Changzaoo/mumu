/**
 * Client for the local importer helper (apps/importer) — the small service the
 * user runs on their OWN machine to fetch audio from a media link (yt-dlp) that
 * a browser cannot fetch itself (CORS + player-signature). The helper returns
 * an MP3 we store in the local library like any imported file.
 *
 * Auth: the server is gated on the owner's Firebase login — every request
 * carries the signed-in user's Firebase ID token, and only the allow-listed
 * owner passes. Knowing the URL grants nothing, so no secret ships in the
 * bundle; the URL default below is just an endpoint, useless without the owner's
 * token. Overridable via the ⚙ config (localStorage).
 */
import { getIdToken } from '@/lib/firebase';
import type { CatalogTrack } from '@/lib/local/catalogMatch';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Erro de uma chamada ao helper que carrega o status HTTP da resposta. A fila
 * de importação (importQueue) usa o `status` para distinguir falha de
 * autenticação (401/403 → pausa a fila inteira, retry não resolve) de falha
 * transitória (retry com backoff resolve). A mensagem segue pt-BR, amigável
 * para o toast/painel.
 */
export class HelperError extends Error {
  /** Status HTTP devolvido pelo helper (ex.: 401, 403, 500). */
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HelperError';
    this.status = status;
  }
}

/** The user's chosen audio quality — sent to the helper so downloads/streams
 *  are encoded at the matching bitrate (96/160/320 kbps, Spotify-style). */
function preferredQuality(): string {
  try {
    return useSettingsStore.getState().audioQuality;
  } catch {
    return 'high';
  }
}

// The importer runs on the owner's home server, exposed via a Cloudflare Tunnel.
// We call it directly: Cloudflare terminates TLS and passes the importer's
// permissive CORS through, so a real browser reaches it with a clean preflight —
// no warning page (unlike the retired ngrok tunnel). A same-origin `/importer/*`
// proxy also exists (Vercel rewrite + Vite dev proxy) for a future zero-CORS
// setup, but it's bypassed for now because Cloudflare Bot Fight Mode challenges
// the server-side Vercel→tunnel hop. Overridable via the ⚙ config (localStorage).
const DEFAULT_HELPER_URL = 'https://importer.nexusholding.xyz';
const STORAGE_KEY = 'aurial:importerUrl';
const TOKEN_KEY = 'aurial:importerToken';

/** Media hosts the helper can resolve — mirrors HOSTS in apps/importer/server.mjs. */
export const IMPORTER_HOSTS: ReadonlyArray<{ match: RegExp; label: string }> = [
  { match: /(^|\.)youtube\.com$/i, label: 'YouTube' },
  { match: /(^|\.)youtu\.be$/i, label: 'YouTube' },
  { match: /(^|\.)music\.youtube\.com$/i, label: 'YouTube Music' },
  { match: /(^|\.)soundcloud\.com$/i, label: 'SoundCloud' },
  { match: /(^|\.)vimeo\.com$/i, label: 'Vimeo' },
  { match: /(^|\.)bandcamp\.com$/i, label: 'Bandcamp' },
];

export function importerHostLabel(host: string): string | null {
  return IMPORTER_HOSTS.find((h) => h.match.test(host))?.label ?? null;
}

/**
 * Addresses that only work on the machine/network that saved them — old
 * localhost defaults, LAN IPs, Tailscale/tailnet names. A device carrying one
 * of these from an earlier build can never reach the importer, so we drop it
 * and fall back to the hosted default (zero-config for every device).
 */
const UNREACHABLE_OVERRIDE =
  /\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.|[^/]*\.ts\.net)/i;

// Retired public endpoints a device may still carry from an older build. We drop
// them so the device self-heals onto the current same-origin default.
const STALE_OVERRIDE = /ngrok|prance-mummified-subscript/i;

export function helperUrl(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)?.replace(/\/$/, '');
    if (stored && (UNREACHABLE_OVERRIDE.test(stored) || STALE_OVERRIDE.test(stored))) {
      window.localStorage.removeItem(STORAGE_KEY); // self-heal stale/unreachable address
      return DEFAULT_HELPER_URL;
    }
    return stored || DEFAULT_HELPER_URL;
  } catch {
    return DEFAULT_HELPER_URL;
  }
}

export function setHelperUrl(url: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ''));
  } catch {
    /* private mode — ignore */
  }
}

/** Optional manual token (advanced/self-host fallback; normally unused). */
export function helperToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setHelperToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    /* private mode — ignore */
  }
}

/**
 * Base headers for every helper request: the signed-in user's Firebase ID token
 * (the server gates on the owner's account). Falls back to a manual token only if
 * one was set in the ⚙ (self-host without login).
 */
async function baseHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  try {
    const idToken = await getIdToken();
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
  } catch {
    /* not signed in — fall through to a manual token if configured */
  }
  if (!headers.Authorization) {
    const manual = helperToken();
    if (manual) headers.Authorization = `Bearer ${manual}`;
  }
  return headers;
}

export interface HelperHealth {
  ok: boolean;
  hosts: string[];
  /** Capabilities of the running importer ('uploader', 'album', 'quality') —
   *  the metadata-team healing pass is gated on these (an OLD importer without
   *  them must never "complete" a healing run). */
  caps: string[];
}

/** Probe the helper with a short timeout. Returns null when it isn't running. */
export async function probeHelper(): Promise<HelperHealth | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${helperUrl()}/health`, {
      signal: controller.signal,
      headers: await baseHeaders(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<HelperHealth>;
    return body.ok
      ? { ok: true, hosts: body.hosts ?? [], caps: Array.isArray(body.caps) ? body.caps : [] }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the running importer supports the metadata-team fields. */
export async function helperSupportsMetaTeam(): Promise<boolean> {
  const health = await probeHelper();
  return Boolean(health?.caps.includes('uploader') && health.caps.includes('album'));
}

// Caps do importador em cache de sessão — o gate do fluxo por job não pode
// custar um /health por faixa. Só memoiza sondagem BEM-SUCEDIDA (importador
// fora do ar agora não pode virar "sem capacidade" para sempre).
let cachedCaps: string[] | null = null;
async function helperCaps(): Promise<string[]> {
  if (cachedCaps) return cachedCaps;
  const health = await probeHelper();
  if (health) cachedCaps = health.caps;
  return health?.caps ?? [];
}

export interface HelperImport {
  blob: Blob;
  title: string;
  /** Source thumbnail (e.g. the YouTube cover) — used until iTunes enriches. */
  coverUrl: string | null;
  /** Real song metadata from yt-dlp (YouTube Music), when available. */
  artist: string | null;
  track: string | null;
  album: string | null;
  /** Channel/uploader name — the artist identity for underground/self-published tracks. */
  uploader: string | null;
}

export interface PlaylistEntry {
  url: string;
  title: string;
}
export interface PlaylistResult {
  title: string;
  entries: PlaylistEntry[];
}

/** True when the link points at a whole playlist/set (not a single track). */
export function isPlaylistUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)music\.youtube\.com$/.test(host)) {
      if (u.pathname.startsWith('/playlist')) return true;
      // watch?v=…&list=… → a single video in a list; pure list → a playlist.
      return u.searchParams.has('list') && !u.searchParams.has('v');
    }
    if (host.endsWith('soundcloud.com')) return /\/sets\//.test(u.pathname);
    return false;
  } catch {
    return false;
  }
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Server-side NVIDIA chat proxy — the API key stays on the importer, never in
 * the browser. Returns the assistant text, or null on any failure.
 */
export async function aiChat(
  messages: AiMessage[],
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<string | null> {
  try {
    const res = await fetch(`${helperUrl()}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await baseHeaders()) },
      body: JSON.stringify({
        messages,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string };
    return typeof data.content === 'string' && data.content.trim() ? data.content : null;
  } catch {
    return null;
  }
}

/** Palavra reconhecida no áudio, com o instante em que começa. */
export interface TranscribedWord {
  text: string;
  startMs: number;
}

/**
 * Transcreve áudio COM tempo por palavra (proxy do importer → Riva).
 *
 * Serve para dar tempo a uma letra que só tem texto — o texto continua vindo
 * da fonte confiável; daqui sai apenas o relógio. Devolve null quando o
 * serviço não está disponível: a letra segue exibida sem sincronia.
 */
export async function aiTranscribe(
  audio: Blob,
  opts: { language?: string; signal?: AbortSignal } = {},
): Promise<TranscribedWord[] | null> {
  try {
    const url = new URL(`${helperUrl()}/ai/transcribe`);
    if (opts.language) url.searchParams.set('language', opts.language);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': audio.type || 'application/octet-stream',
        ...(await baseHeaders()),
      },
      body: audio,
      signal: opts.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { words?: unknown };
    if (!Array.isArray(data.words)) return null;
    return data.words
      .map((w) => w as { text?: unknown; startMs?: unknown })
      .filter((w) => typeof w.text === 'string' && typeof w.startMs === 'number')
      .map((w) => ({ text: w.text as string, startMs: w.startMs as number }));
  } catch {
    return null;
  }
}

/**
 * Vetoriza textos (recomendação semântica) via proxy do importer.
 *
 * `inputType` importa: estes modelos geram vetores diferentes para indexar
 * ('passage') e para consultar ('query'); misturar os dois degrada a
 * semelhança em silêncio. Devolve null quando a IA não está disponível — o
 * chamador degrada para a recomendação heurística.
 */
export async function aiEmbed(
  input: string[],
  inputType: 'passage' | 'query' = 'passage',
): Promise<Array<number[] | null> | null> {
  if (input.length === 0) return [];
  try {
    const res = await fetch(`${helperUrl()}/ai/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await baseHeaders()) },
      body: JSON.stringify({ input, input_type: inputType }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: unknown };
    if (!Array.isArray(data.embeddings)) return null;
    return data.embeddings.map((v) =>
      Array.isArray(v) && v.every((n) => typeof n === 'number') ? (v as number[]) : null,
    );
  } catch {
    return null;
  }
}

/**
 * Live-stream URL for INSTANT playback of a media link (the importer pipes
 * yt-dlp → ffmpeg → mp3, so playback starts in seconds, no full download). The
 * Firebase token goes in the query because an <audio> element can't send
 * headers. Returns null when signed out.
 */
export async function buildStreamUrl(sourceUrl: string): Promise<string | null> {
  const token = await getIdToken().catch(() => null);
  if (!token) return null;
  return `${helperUrl()}/stream?url=${encodeURIComponent(sourceUrl)}&token=${encodeURIComponent(token)}&quality=${encodeURIComponent(preferredQuality())}`;
}

/**
 * Upload a local track's audio to the importer so the user's OTHER devices
 * (which only sync metadata) can stream the exact file. Returns a stable
 * capability URL (token in the query, since an <audio> element can't send
 * headers) to store in the synced metadata, or null on failure / signed out.
 */
export async function uploadTrackBlob(id: string, blob: Blob): Promise<string | null> {
  try {
    const headers = await baseHeaders();
    if (!headers.Authorization) return null; // must be signed in to upload
    const res = await fetch(`${helperUrl()}/blob`, {
      method: 'POST',
      headers: { ...headers, 'X-Blob-Id': id, 'Content-Type': blob.type || 'audio/mpeg' },
      body: blob,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string; token?: string };
    if (!data.token) return null;
    return `${helperUrl()}/blob/${encodeURIComponent(id)}?k=${encodeURIComponent(data.token)}`;
  } catch {
    return null;
  }
}

export interface TrackMeta {
  title: string | null;
  artist: string | null;
  track: string | null;
  album: string | null;
  thumbnail: string | null;
  /** Channel/uploader name — the artist identity for underground/self-published tracks. */
  uploader: string | null;
}

/** Real song metadata for a media link WITHOUT downloading — to re-identify a
 *  track from its source. Returns null when unavailable / on failure. */
export async function fetchTrackMeta(url: string): Promise<TrackMeta | null> {
  try {
    const res = await fetch(`${helperUrl()}/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await baseHeaders()) },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    return (await res.json()) as TrackMeta;
  } catch {
    return null;
  }
}

export interface AlbumInfo {
  title: string;
  artist: string;
  coverUrl: string | null;
  /** Titles of every track in the real album — membership proof for credits. */
  tracks: string[];
}

/**
 * A "lente" de álbum: identifica o álbum REAL no catálogo (Deezer, via o
 * importer) e devolve artista/capa/tracklist autoritativos. O VERIFICADOR
 * (metaTeam) só adota o resultado quando a faixa está na tracklist.
 */
export async function fetchAlbumInfo(title: string, artist?: string): Promise<AlbumInfo | null> {
  try {
    const params = new URLSearchParams({ title });
    if (artist) params.set('artist', artist);
    const res = await fetch(`${helperUrl()}/album?${params.toString()}`, {
      headers: await baseHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { album?: Partial<AlbumInfo> | null };
    const album = data.album;
    if (!album || typeof album.title !== 'string' || typeof album.artist !== 'string') return null;
    return {
      title: album.title,
      artist: album.artist,
      coverUrl: typeof album.coverUrl === 'string' ? album.coverUrl : null,
      tracks: Array.isArray(album.tracks)
        ? album.tracks.filter((t): t is string => typeof t === 'string' && t.length > 0)
        : [],
    };
  } catch {
    return null;
  }
}

export interface CoverHit {
  coverUrl: string;
  album: string | null;
  artist: string | null;
  title: string | null;
}

/**
 * Capa REAL de uma faixa pelo Deezer (via o importer — a api.deezer.com não
 * manda CORS). Segunda parada da varredura de capas, depois do iTunes. Devolve
 * null quando não achou/o importer não responde: a varredura segue para a
 * MusicBrainz e nada quebra.
 */
export async function fetchCover(title: string, artist?: string | null): Promise<CoverHit | null> {
  // Passe de fundo: teto curto, jamais pode segurar a UI nem ficar pendurado.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const params = new URLSearchParams({ title });
    if (artist) params.set('artist', artist);
    const res = await fetch(`${helperUrl()}/cover?${params.toString()}`, {
      headers: await baseHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<CoverHit>;
    if (typeof data.coverUrl !== 'string' || !data.coverUrl) return null;
    return {
      coverUrl: data.coverUrl,
      album: typeof data.album === 'string' ? data.album : null,
      artist: typeof data.artist === 'string' ? data.artist : null,
      title: typeof data.title === 'string' ? data.title : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Catálogo completo de um artista (todos os álbuns, todos os perfis homônimos).
 *
 * Timeout generoso de propósito: são dezenas de chamadas à Deezer do lado do
 * servidor. Roda em varredura de fundo, uma vez por artista por dia — pode
 * demorar; o que não pode é voltar vazio por impaciência e deixar o acervo
 * inteiro sem identificação.
 */
export async function fetchArtistCatalog(name: string): Promise<CatalogTrack[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(`${helperUrl()}/artist-catalog?name=${encodeURIComponent(name)}`, {
      headers: await baseHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { tracks?: unknown };
    if (!Array.isArray(data.tracks)) return [];
    return data.tracks.filter(
      (t): t is CatalogTrack =>
        !!t && typeof (t as CatalogTrack).title === 'string' && !!(t as CatalogTrack).title,
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export interface TrackCredits {
  label: string | null;
  catalogNumber: string | null;
  composer: string | null;
  coverUrl: string | null;
}

/**
 * Ficha técnica (MusicBrainz, via o importer): gravadora, número de catálogo e
 * compositor — os únicos campos que nenhuma outra fonte tem. A capa (Cover Art
 * Archive) vem junto e serve de último recurso. Null em qualquer falha.
 */
export async function fetchCredits(
  title: string,
  artist?: string | null,
): Promise<TrackCredits | null> {
  // A MusicBrainz é serializada a 1 req/s no importer e cada consulta faz até
  // 4 saltos — o teto aqui é proporcionalmente mais folgado que o do /cover.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const params = new URLSearchParams({ title });
    if (artist) params.set('artist', artist);
    const res = await fetch(`${helperUrl()}/credits?${params.toString()}`, {
      headers: await baseHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<TrackCredits>;
    const pick = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
    const credits: TrackCredits = {
      label: pick(data.label),
      catalogNumber: pick(data.catalogNumber),
      composer: pick(data.composer),
      coverUrl: pick(data.coverUrl),
    };
    return credits.label || credits.composer || credits.coverUrl ? credits : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface NetworkSpeed {
  downMbps: number | null;
  upMbps: number | null;
}

/**
 * Measure the user's REAL network speed against the importer (`/speed`):
 * timed 3MB download + 1.5MB upload. Returns nulls when the importer is
 * unreachable / signed out — telemetry then falls back to the browser's
 * connection estimate.
 */
export async function measureNetworkSpeed(): Promise<NetworkSpeed> {
  const result: NetworkSpeed = { downMbps: null, upMbps: null };
  try {
    const headers = await baseHeaders();
    if (!headers.Authorization) return result;

    const t0 = performance.now();
    const res = await fetch(`${helperUrl()}/speed?bytes=3000000`, { headers, cache: 'no-store' });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      const seconds = (performance.now() - t0) / 1000;
      if (seconds > 0 && buf.byteLength > 0) {
        result.downMbps = Math.round(((buf.byteLength * 8) / seconds / 1e6) * 10) / 10;
      }
    }

    const payload = new Uint8Array(1_500_000);
    for (let i = 0; i < payload.length; i += 65_536) {
      crypto.getRandomValues(payload.subarray(i, Math.min(i + 65_536, payload.length)));
    }
    const t1 = performance.now();
    const up = await fetch(`${helperUrl()}/speed`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: payload,
    });
    if (up.ok) {
      const seconds = (performance.now() - t1) / 1000;
      if (seconds > 0) {
        result.upMbps = Math.round(((payload.byteLength * 8) / seconds / 1e6) * 10) / 10;
      }
    }
  } catch {
    /* offline / helper down — keep nulls */
  }
  return result;
}

/** Fetch a real artist photo (Deezer, via the importer to dodge CORS). */
export async function fetchArtistImage(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${helperUrl()}/artist-image?name=${encodeURIComponent(name)}`, {
      headers: await baseHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { imageUrl?: string | null };
    return typeof data.imageUrl === 'string' && data.imageUrl ? data.imageUrl : null;
  } catch {
    return null;
  }
}

/** Uma faixa do "top" do artista, na ordem de popularidade REAL (Deezer). */
export interface ArtistTopTrack {
  title: string;
  rank: number;
  album: string | null;
  duration: number | null;
}

export interface ArtistTop {
  /** Nome canônico no catálogo — serve para conferir que casou o artista certo. */
  name: string | null;
  picture: string | null;
  fans: number | null;
  tracks: ArtistTopTrack[];
}

/**
 * O ranking de popularidade mundial do artista (Deezer, via o importer para
 * driblar o CORS). Usado só para ORDENAR as faixas que o usuário já tem — nada
 * daqui vira faixa nova. Devolve null quando o importer/rede não responde: a
 * página cai na ordem local sem quebrar.
 */
export async function fetchArtistTop(name: string): Promise<ArtistTop | null> {
  // Ordenar uma lista nunca pode segurar a página: teto curto e explícito.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(`${helperUrl()}/artist-top?name=${encodeURIComponent(name)}`, {
      headers: await baseHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      artist?: { name?: unknown; picture?: unknown; nb_fan?: unknown } | null;
      tracks?: unknown;
    };
    const rows = Array.isArray(data.tracks) ? data.tracks : [];
    const tracks = rows
      .map((t) => t as Partial<ArtistTopTrack>)
      .filter((t): t is ArtistTopTrack => typeof t.title === 'string' && t.title.length > 0)
      .map((t) => ({
        title: t.title,
        rank: typeof t.rank === 'number' ? t.rank : 0,
        album: typeof t.album === 'string' ? t.album : null,
        duration: typeof t.duration === 'number' ? t.duration : null,
      }));
    if (tracks.length === 0) return null;
    return {
      name: typeof data.artist?.name === 'string' ? data.artist.name : null,
      picture: typeof data.artist?.picture === 'string' ? data.artist.picture : null,
      fans: typeof data.artist?.nb_fan === 'number' ? data.artist.nb_fan : null,
      tracks,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort delete of an uploaded library blob (on track removal). */
export async function deleteTrackBlob(id: string): Promise<void> {
  try {
    await fetch(`${helperUrl()}/blob/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await baseHeaders(),
    });
  } catch {
    /* ignore */
  }
}

/** Ask the helper to enumerate a playlist's entries (no download). */
export async function fetchPlaylistEntries(url: string): Promise<PlaylistResult> {
  let res: Response;
  try {
    res = await fetch(`${helperUrl()}/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await baseHeaders()) },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new Error('Não foi possível ler a playlist agora. Tente novamente em instantes.');
  }
  if (!res.ok) {
    let message = `Falha ao ler a playlist (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep default */
    }
    throw new HelperError(message, res.status);
  }
  const data = (await res.json()) as Partial<PlaylistResult>;
  const entries = Array.isArray(data.entries)
    ? data.entries.filter((e): e is PlaylistEntry => Boolean(e && typeof e.url === 'string'))
    : [];
  return { title: typeof data.title === 'string' ? data.title : 'Playlist', entries };
}

// Job de import: intervalo do acompanhamento e teto total (playlists têm
// faixas longas; 15 min cobre qualquer música real sem segurar slot infinito).
const JOB_POLL_MS = 2_500;
const JOB_TIMEOUT_MS = 15 * 60_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface JobStatus {
  status: 'running' | 'done' | 'error';
  error?: string | null;
  permanent?: boolean;
  meta?: {
    title?: string | null;
    coverUrl?: string | null;
    artist?: string | null;
    track?: string | null;
    album?: string | null;
    uploader?: string | null;
  } | null;
}

/**
 * Fluxo por JOB (importador novo): start → acompanha → busca o arquivo pronto.
 * O POST /import clássico ficava mudo até o MP3 terminar e o Cloudflare matava
 * a conexão em ~100s (erro 524) — download longo era progresso jogado fora.
 * Aqui cada consulta é leve, a rede do cliente pode piscar sem matar o job, e
 * o arquivo desce numa transferência curta.
 */
async function importViaJob(url: string): Promise<HelperImport> {
  let start: Response;
  try {
    start = await fetch(`${helperUrl()}/import/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await baseHeaders()) },
      body: JSON.stringify({ url, quality: preferredQuality() }),
    });
  } catch {
    throw new Error('Não foi possível baixar esse link agora. Tente novamente em instantes.');
  }
  if (!start.ok) {
    let message = `Falha na importação (${start.status}).`;
    try {
      const body = (await start.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep default */
    }
    throw new HelperError(message, start.status);
  }
  const { id } = (await start.json()) as { id?: string };
  if (!id) throw new Error('O importador não abriu o download.');

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let meta: NonNullable<JobStatus['meta']> = {};
  for (;;) {
    await sleep(JOB_POLL_MS);
    if (Date.now() > deadline) throw new Error('O download demorou demais e foi abortado.');
    let res: Response;
    try {
      res = await fetch(`${helperUrl()}/import/job/${encodeURIComponent(id)}`, {
        headers: await baseHeaders(),
      });
    } catch {
      continue; // rede piscou — o job segue vivo no servidor, só continua olhando
    }
    if (res.status === 404) throw new Error('O download expirou no servidor. Tente de novo.');
    if (!res.ok) continue; // 5xx transitório do túnel — não desiste do job
    const body = (await res.json()) as JobStatus;
    if (body.status === 'error') {
      throw new HelperError(body.error ?? 'Falha na importação.', body.permanent ? 422 : 500);
    }
    if (body.status === 'done') {
      meta = body.meta ?? {};
      break;
    }
  }

  const file = await fetch(`${helperUrl()}/import/file/${encodeURIComponent(id)}`, {
    headers: await baseHeaders(),
  });
  if (!file.ok) throw new HelperError(`Falha ao buscar o arquivo (${file.status}).`, file.status);
  const blob = await file.blob();
  if (blob.size === 0) throw new Error('O importador devolveu um arquivo vazio.');
  return {
    blob,
    title: meta.title ?? 'faixa',
    coverUrl: meta.coverUrl ?? null,
    artist: meta.artist ?? null,
    track: meta.track ?? null,
    album: meta.album ?? null,
    uploader: meta.uploader ?? null,
  };
}

/** Ask the helper to fetch + convert `url`; resolves with the MP3 blob + title. */
export async function importViaHelper(url: string): Promise<HelperImport> {
  // Importador novo → fluxo por job (sem 524, sem progresso perdido).
  if ((await helperCaps()).includes('jobs')) return importViaJob(url);

  let res: Response;
  try {
    res = await fetch(`${helperUrl()}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await baseHeaders()) },
      body: JSON.stringify({ url, quality: preferredQuality() }),
    });
  } catch {
    throw new Error('Não foi possível baixar esse link agora. Tente novamente em instantes.');
  }
  if (!res.ok) {
    let message = `Falha na importação (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep default */
    }
    throw new HelperError(message, res.status);
  }
  const decode = (h: string): string | null => {
    const v = res.headers.get(h);
    return v ? decodeURIComponent(v) : null;
  };
  const title = decode('X-Aurial-Title') ?? 'faixa';
  const coverUrl = decode('X-Aurial-Cover');
  const artist = decode('X-Aurial-Artist');
  const track = decode('X-Aurial-Track');
  const album = decode('X-Aurial-Album');
  const uploader = decode('X-Aurial-Uploader');
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('O importador devolveu um arquivo vazio.');
  return { blob, title, coverUrl, artist, track, album, uploader };
}
