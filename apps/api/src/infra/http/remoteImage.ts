/**
 * Guarded fetch for remote cover art.
 *
 * Cover URLs reach us from upload metadata and from yt-dlp thumbnails, i.e.
 * partly from user input, and the worker fetching them sits inside the private
 * network. An unguarded `fetch` there is an SSRF primitive and an unbounded
 * allocation, so every request is constrained on four axes: scheme, resolved
 * address, declared content type, and body size.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { logger } from '../../core/logger.js';

const log = logger.child({ infra: 'remote-image' });

/** Cover art past this is never legitimate; refuse rather than buffer it. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * True for addresses that only mean something inside our own network:
 * loopback, RFC1918, link-local (incl. cloud metadata at 169.254.169.254),
 * CGNAT, unique-local IPv6 and multicast.
 */
export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 0) return true; // not an address we can vet

  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  const normalized = ip.toLowerCase();
  // IPv4-mapped (::ffff:10.0.0.1) — vet the embedded v4 address instead.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1]) return isBlockedAddress(mapped[1]);
  if (normalized === '::' || normalized === '::1') return true;
  if (/^f[cd]/.test(normalized)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(normalized)) return true; // fe80::/10 link-local
  if (normalized.startsWith('ff')) return true; // multicast
  return false;
}

/**
 * Download a remote image, or return `null` if it fails any guard.
 * Never throws — the caller treats a missing cover as "no art".
 */
export async function fetchRemoteImage(rawUrl: string): Promise<Buffer | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    log.warn({ protocol: url.protocol }, 'cover URL rejected: unsupported scheme');
    return null;
  }

  // Resolve first so we never even open a socket to an internal address.
  try {
    const resolved = await lookup(url.hostname, { all: true });
    if (resolved.length === 0) return null;
    const blocked = resolved.find((entry) => isBlockedAddress(entry.address));
    if (blocked) {
      log.warn(
        { host: url.hostname, address: blocked.address },
        'cover URL rejected: private address',
      );
      return null;
    }
  } catch {
    return null; // unresolvable host
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // A redirect could land on an address we just vetted away.
      redirect: 'error',
      headers: { accept: 'image/*' },
    });
    if (!response.ok) {
      log.warn({ url: url.href, status: response.status }, 'cover URL fetch failed');
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      log.warn({ url: url.href, contentType }, 'cover URL rejected: not an image');
      return null;
    }

    const declared = Number(response.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      log.warn({ url: url.href, declared }, 'cover URL rejected: too large');
      return null;
    }

    // Stream so a lying content-length cannot make us buffer the whole body.
    if (!response.body) return null;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        log.warn({ url: url.href }, 'cover URL rejected: body exceeded size cap mid-stream');
        return null;
      }
      chunks.push(Buffer.from(chunk));
    }
    return chunks.length > 0 ? Buffer.concat(chunks) : null;
  } catch (err) {
    log.warn({ err, url: url.href }, 'cover URL fetch errored');
    return null;
  }
}
