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
    return body.ok ? { ok: true, hosts: body.hosts ?? [] } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

/**
 * Live-stream URL for INSTANT playback of a media link (the importer pipes
 * yt-dlp → ffmpeg → mp3, so playback starts in seconds, no full download). The
 * Firebase token goes in the query because an <audio> element can't send
 * headers. Returns null when signed out.
 */
export async function buildStreamUrl(sourceUrl: string): Promise<string | null> {
  const token = await getIdToken().catch(() => null);
  if (!token) return null;
  return `${helperUrl()}/stream?url=${encodeURIComponent(sourceUrl)}&token=${encodeURIComponent(token)}`;
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
    throw new Error(message);
  }
  const data = (await res.json()) as Partial<PlaylistResult>;
  const entries = Array.isArray(data.entries)
    ? data.entries.filter((e): e is PlaylistEntry => Boolean(e && typeof e.url === 'string'))
    : [];
  return { title: typeof data.title === 'string' ? data.title : 'Playlist', entries };
}

/** Ask the helper to fetch + convert `url`; resolves with the MP3 blob + title. */
export async function importViaHelper(url: string): Promise<HelperImport> {
  let res: Response;
  try {
    res = await fetch(`${helperUrl()}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await baseHeaders()) },
      body: JSON.stringify({ url }),
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
    throw new Error(message);
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
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('O importador devolveu um arquivo vazio.');
  return { blob, title, coverUrl, artist, track, album };
}
