/**
 * Client for the local importer helper (apps/importer) — the small service the
 * user runs on their OWN machine to fetch audio from a media link (yt-dlp) that
 * a browser cannot fetch itself (CORS + player-signature). The helper returns
 * an MP3 we store in the local library like any imported file.
 *
 * The helper listens on localhost; browsers permit http://127.0.0.1 requests
 * even from an https page (localhost is a secure context), and the helper sends
 * the Private-Network-Access header so the hosted PWA can reach it too.
 */
const DEFAULT_HELPER_URL = 'http://127.0.0.1:8787';
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

export function helperUrl(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.replace(/\/$/, '') || DEFAULT_HELPER_URL;
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

/** Shared secret for a publicly-exposed helper (empty = none). */
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
 * Base headers for every helper request: the auth token (when set) plus the
 * ngrok bypass header (harmless off-ngrok) so a public ngrok tunnel doesn't
 * serve its browser-warning interstitial instead of our response.
 */
function baseHeaders(): Record<string, string> {
  const token = helperToken();
  return {
    'ngrok-skip-browser-warning': '1',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
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
      headers: baseHeaders(),
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
}

/** Ask the helper to fetch + convert `url`; resolves with the MP3 blob + title. */
export async function importViaHelper(url: string): Promise<HelperImport> {
  let res: Response;
  try {
    res = await fetch(`${helperUrl()}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...baseHeaders() },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new Error(
      'O importador local não respondeu. Ele está rodando? (node apps/importer/server.mjs)',
    );
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
  const titleHeader = res.headers.get('X-Aurial-Title');
  const title = titleHeader ? decodeURIComponent(titleHeader) : 'faixa';
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('O importador devolveu um arquivo vazio.');
  return { blob, title };
}
