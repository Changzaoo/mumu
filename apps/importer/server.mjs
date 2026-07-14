#!/usr/bin/env node
/**
 * Aurial — local importer helper.
 *
 * A tiny, zero-dependency HTTP service you run on YOUR OWN machine. It is the
 * one piece a browser cannot do itself: fetch audio from a media link (via
 * yt-dlp) and hand the resulting MP3 back to the Aurial web app, which stores
 * it in your local library like any imported file.
 *
 * ⚠️  Personal / self-host use only. Import ONLY content you are authorized to
 * download (your own uploads, Creative Commons, public domain). Downloading
 * copyrighted material without permission may violate the source platform's
 * Terms of Service and copyright law — that responsibility is yours. This
 * helper listens on localhost only and is never part of the hosted site.
 *
 * Run:  node apps/importer/server.mjs
 * Env:  PORT (default 8787) · YTDLP_PATH · FFMPEG_PATH · ALLOW_ORIGIN (csv, '*' = any)
 *       AURIAL_MAX_MINUTES (default 90) · IMPORT_ALLOWED_EMAILS (csv allow-list)
 *       IMPORT_REQUIRE_LOGIN (1 = any signed-in Firebase user) · IMPORT_TOKEN
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, chmod, writeFile, unlink, mkdir } from 'node:fs/promises';
import { createWriteStream, createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8787);
// Bind address. Default localhost (safest). Set HOST=0.0.0.0 to reach it from
// other devices on your LAN / Tailscale (see README — mind the exposure).
const HOST = process.env.HOST ?? '127.0.0.1';
// Optional shared secret (legacy fallback). Prefer Firebase gating below.
const IMPORT_TOKEN = (process.env.IMPORT_TOKEN ?? '').trim();

// ── Firebase auth gate ──────────────────────────────────────────────────────
// Two Firebase-gated modes, both requiring a valid Firebase ID token (knowing
// the URL grants nothing, and no shared secret ships in the browser bundle):
//   • IMPORT_ALLOWED_EMAILS set → only those (verified) emails may import.
//   • IMPORT_REQUIRE_LOGIN=1    → ANY signed-in user with a verified email may
//     import (open to every logged-in user, but anonymous callers are blocked).
// If neither is set, falls back to the shared token, else fully open.
const FIREBASE_PROJECT_ID = (process.env.FIREBASE_PROJECT_ID ?? 'mumu-2f54e').trim();
const ALLOWED_EMAILS = (process.env.IMPORT_ALLOWED_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const REQUIRE_LOGIN = /^(1|true|yes|on)$/i.test((process.env.IMPORT_REQUIRE_LOGIN ?? '').trim());
const FIREBASE_GATED = ALLOWED_EMAILS.length > 0 || REQUIRE_LOGIN;
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache = { certs: {}, exp: 0 };
async function googleCerts() {
  if (certCache.exp > Date.now()) return certCache.certs;
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error('cert fetch failed');
  const certs = await res.json();
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  certCache = { certs, exp: Date.now() + (m ? Number(m[1]) * 1000 : 3600_000) };
  return certs;
}

const b64urlJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/** Verify a Firebase ID token (RS256) and return its claims, or throw. */
async function verifyFirebaseToken(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = b64urlJson(parts[0]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad alg/kid');
  const pem = (await googleCerts())[header.kid];
  if (!pem) throw new Error('unknown signing key');
  const pub = new crypto.X509Certificate(pem).publicKey;
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    pub,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!ok) throw new Error('bad signature');
  const p = b64urlJson(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (p.aud !== FIREBASE_PROJECT_ID) throw new Error('bad audience');
  if (p.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) throw new Error('bad iss');
  if (typeof p.exp !== 'number' || p.exp <= now) throw new Error('expired');
  if (typeof p.iat !== 'number' || p.iat > now + 60) throw new Error('bad iat');
  if (!p.sub) throw new Error('no subject');
  return p;
}
const MAX_MINUTES = Number(process.env.AURIAL_MAX_MINUTES ?? 90);
const MAX_BYTES = 600 * 1024 * 1024;
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Media-page hosts this helper knows how to resolve. Keep in sync with the web. */
const HOSTS = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'soundcloud.com',
  'vimeo.com',
  'bandcamp.com',
];

// Default allowed browser origins: local dev + the hosted PWA (which may call
// this localhost helper). Override with ALLOW_ORIGIN=csv. Includes both the
// radinho.online domain (current) and the older aurial.vercel.app URL.
const ALLOW_ORIGINS = (
  process.env.ALLOW_ORIGIN ??
  'http://localhost:5173,http://127.0.0.1:5173,https://radinho.online,https://*.radinho.online,https://aurial.vercel.app,https://*.vercel.app'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * True when `origin` is on the allow-list. Supports `*.domain` entries so
 * Vercel preview deploys and any radinho.online subdomain match without listing
 * each one. '*' (any) is handled separately in applyCors.
 */
function originAllowed(origin) {
  return ALLOW_ORIGINS.some((entry) => {
    if (entry === origin) return true;
    const star = entry.indexOf('*.');
    if (star === -1) return false;
    // 'https://*.vercel.app' → scheme 'https://', suffix '.vercel.app'
    const scheme = entry.slice(0, star);
    const suffix = entry.slice(star + 1); // '.vercel.app'
    return origin.startsWith(scheme) && origin.slice(scheme.length).endsWith(suffix);
  });
}

function hostSupported(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// ── yt-dlp resolution (auto-download the standalone binary if absent) ────────
const isWin = process.platform === 'win32';
const localBin = path.join(HERE, '.bin', isWin ? 'yt-dlp.exe' : 'yt-dlp');

function ytdlpAsset() {
  if (isWin) return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp_linux';
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const get = (u) =>
      https
        .get(u, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`download failed (${res.statusCode})`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve(dest)));
        })
        .on('error', reject);
    get(url);
  });
}

async function resolveYtdlp() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  if (existsSync(localBin)) return localBin;
  // Fall back to PATH: try running `yt-dlp --version`.
  const onPath = await new Promise((res) => {
    const p = spawn(isWin ? 'yt-dlp.exe' : 'yt-dlp', ['--version']);
    p.on('error', () => res(false));
    p.on('close', (code) => res(code === 0));
  });
  if (onPath) return isWin ? 'yt-dlp.exe' : 'yt-dlp';
  // Auto-download the standalone binary next to this script.
  log(`yt-dlp not found — downloading ${ytdlpAsset()}…`);
  const dir = path.join(HERE, '.bin');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  await download(
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAsset()}`,
    localBin,
  );
  if (!isWin) await chmod(localBin, 0o755);
  log('yt-dlp downloaded.');
  return localBin;
}

// ── download + extract one URL to an MP3 on disk ─────────────────────────────
// Spotify-style quality ladder (kbps). 'lossless' maps to 320 — the sources are
// lossy already, so a FLAC re-encode would only inflate the file, not the sound.
const QUALITY_KBPS = { low: 96, normal: 160, high: 320, lossless: 320 };
const kbpsFor = (quality) => QUALITY_KBPS[quality] ?? 320;

async function importToMp3(ytdlp, url, quality) {
  const dir = await mkdtemp(path.join(tmpdir(), 'aurial-import-'));
  const args = [
    '--no-playlist',
    '--no-progress',
    '--no-warnings',
    // Resilience against YouTube's transient 403s / throttling / bot-checks
    // under load: retry, and pace requests + downloads so we look less botty.
    '--retries',
    '5',
    '--fragment-retries',
    '10',
    '--extractor-retries',
    '3',
    '--sleep-requests',
    '1',
    '--sleep-interval',
    '2',
    '--max-sleep-interval',
    '6',
    // Optional YouTube cookies (Netscape cookies.txt) to pass the "not a bot"
    // gate on large batches — set YTDLP_COOKIES to the file path.
    ...(process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
    '-f',
    'bestaudio/best',
    '-x',
    '--audio-format',
    'mp3',
    // Constant bitrate from the user's quality setting (default 320 kbps —
    // Spotify's "Muito alta"). Encoding above the source never loses anything;
    // it just avoids a second lossy generation on top of the source codec.
    '--audio-quality',
    `${kbpsFor(quality)}K`,
    '--embed-thumbnail',
    '--embed-metadata',
    '--write-info-json',
    '--match-filter',
    `duration < ${MAX_MINUTES * 60}`,
    '--max-filesize',
    String(MAX_BYTES),
    '-o',
    path.join(dir, 'audio.%(ext)s'),
  ];
  if (process.env.FFMPEG_PATH) args.push('--ffmpeg-location', process.env.FFMPEG_PATH);
  args.push(url);

  await new Promise((resolve, reject) => {
    let stderr = '';
    const p = spawn(ytdlp, args, { windowsHide: true });
    p.stderr.on('data', (c) => {
      stderr += c;
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(interpret(stderr))),
    );
  });

  const files = await readdir(dir);
  const mp3 = files.find((f) => f.endsWith('.mp3'));
  if (!mp3) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`Sem áudio, ou vídeo maior que ${MAX_MINUTES} min.`);
  }
  let title = 'faixa';
  let thumbnail = '';
  let artist = '';
  let track = '';
  let album = '';
  let uploader = '';
  try {
    const info = JSON.parse(await readFile(path.join(dir, 'audio.info.json'), 'utf8'));
    if (typeof info.title === 'string' && info.title.trim()) title = info.title.trim();
    if (typeof info.thumbnail === 'string' && info.thumbnail.trim()) thumbnail = info.thumbnail.trim();
    // YouTube Music (and many music videos) carry proper song metadata — far more
    // reliable than parsing the video title. `artist` may be a string or array.
    const rawArtist = Array.isArray(info.artists)
      ? info.artists.join(', ')
      : info.artist || info.creator || '';
    if (typeof rawArtist === 'string' && rawArtist.trim()) artist = rawArtist.trim();
    if (typeof info.track === 'string' && info.track.trim()) track = info.track.trim();
    if (typeof info.album === 'string' && info.album.trim()) album = info.album.trim();
    // Channel/uploader name — for underground/self-published tracks (no catalog
    // entry, bare titles like "MILAGRE") the channel IS the artist identity.
    const rawUploader = info.uploader || info.channel || '';
    if (typeof rawUploader === 'string' && rawUploader.trim()) uploader = rawUploader.trim();
  } catch {
    /* keep default */
  }
  return { dir, file: path.join(dir, mp3), title, thumbnail, artist, track, album, uploader };
}

function interpret(stderr) {
  const s = stderr.toLowerCase();
  if (s.includes('not a bot') || s.includes('confirm you'))
    return 'O YouTube pediu verificação (muitos downloads seguidos). Aguarde alguns minutos ou configure cookies.';
  if (s.includes('private video') || s.includes('sign in') || s.includes('login'))
    return 'Conteúdo privado ou exige login.';
  if (s.includes('video unavailable') || s.includes('removed')) return 'Conteúdo indisponível.';
  if (s.includes('unsupported url') || s.includes('unable to extract'))
    return 'Link não suportado.';
  return 'Não foi possível baixar desse link.';
}

// Max playlist entries returned in one enumeration (keeps it snappy + sane).
const MAX_PLAYLIST = Number(process.env.AURIAL_MAX_PLAYLIST ?? 200);

// ── NVIDIA AI proxy (key stays server-side) ─────────────────────────────────
const NVIDIA_API_KEY = (process.env.NVIDIA_API_KEY ?? '').trim();
const NVIDIA_BASE = (process.env.NVIDIA_BASE ?? 'https://integrate.api.nvidia.com/v1').replace(
  /\/$/,
  '',
);
const NVIDIA_MODEL = process.env.NVIDIA_MODEL ?? 'meta/llama-3.1-8b-instruct';

const FFMPEG_BIN = process.env.FFMPEG_PATH
  ? path.join(process.env.FFMPEG_PATH, isWin ? 'ffmpeg.exe' : 'ffmpeg')
  : isWin
    ? 'ffmpeg.exe'
    : 'ffmpeg';

// ── Uploaded library blobs (cross-device playback of imported/uploaded audio) ──
// A user's imported/uploaded audio is stored here so their OTHER devices (which
// only sync metadata) can stream the exact file. Each blob has an unguessable
// capability token; the play URL carries it in the query (an <audio> element
// can't send headers). Kept on the eMMC root, never the flaky USB disk.
const BLOB_DIR = process.env.BLOB_DIR ?? path.join(HERE, 'blobs');
const MAX_BLOB = 140 * 1024 * 1024; // 140 MB per file (matches the client cap)
const safeBlobId = (s) => typeof s === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(s);
const blobPath = (id) => path.join(BLOB_DIR, `${encodeURIComponent(id)}.bin`);
const blobMetaPath = (id) => path.join(BLOB_DIR, `${encodeURIComponent(id)}.json`);

/** Buffer a request body (binary-safe) up to `limit` bytes, else reject. */
function readBinaryBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Authorize a bare token (from a query string) the same way as a Bearer header —
 * for the streaming endpoint, since an <audio> element can't send headers.
 */
async function authorizeToken(token) {
  if (FIREBASE_GATED) {
    if (!token) return false;
    try {
      const claims = await verifyFirebaseToken(token);
      if (!claims.email_verified) return false;
      if (ALLOWED_EMAILS.length === 0) return true;
      return ALLOWED_EMAILS.includes(String(claims.email || '').toLowerCase());
    } catch {
      return false;
    }
  }
  if (IMPORT_TOKEN) return token === IMPORT_TOKEN;
  return true;
}

/** Dump a single video's full metadata JSON WITHOUT downloading the media. */
async function dumpJson(ytdlp, url) {
  const args = ['--no-playlist', '--no-warnings', '--skip-download', '--dump-single-json', url];
  const out = await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const p = spawn(ytdlp, args, { windowsHide: true });
    p.stdout.on('data', (c) => {
      stdout += c;
      if (stdout.length > 50_000_000) p.kill();
    });
    p.stderr.on('data', (c) => {
      stderr += c;
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(interpret(stderr)))));
  });
  return JSON.parse(out);
}

/**
 * Enumerate a playlist's entries WITHOUT downloading them (flat, fast). Returns
 * `{ title, entries: [{ url, title }] }` — the web app then imports each entry
 * through the normal /import path.
 */
async function listPlaylist(ytdlp, url) {
  const args = [
    '--flat-playlist',
    '--no-warnings',
    '--dump-single-json',
    '--playlist-end',
    String(MAX_PLAYLIST),
    ...(process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
    url,
  ];
  const stdout = await new Promise((resolve, reject) => {
    let out = '';
    let stderr = '';
    const p = spawn(ytdlp, args, { windowsHide: true });
    p.stdout.on('data', (c) => {
      out += c;
      if (out.length > 50_000_000) p.kill(); // runaway guard
    });
    p.stderr.on('data', (c) => {
      stderr += c;
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(interpret(stderr)))));
  });

  const data = JSON.parse(stdout);
  const isYouTube = /youtube/i.test(String(data.extractor_key || data.extractor || ''));
  const raw = Array.isArray(data.entries) ? data.entries : [];
  const entries = [];
  for (const e of raw) {
    if (!e) continue;
    let u = typeof e.url === 'string' ? e.url : '';
    if (u && !/^https?:\/\//.test(u)) u = ''; // flat url was just an id
    if (!u && e.id && isYouTube) u = `https://www.youtube.com/watch?v=${e.id}`;
    if (u) entries.push({ url: u, title: typeof e.title === 'string' ? e.title : '' });
  }
  return { title: typeof data.title === 'string' ? data.title : 'Playlist', entries };
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────
function applyCors(req, res) {
  const origin = req.headers.origin;
  // ALLOW_ORIGIN='*' opens the helper to any site/device (no secrets involved,
  // no cookies used). Otherwise only the explicit allow-list gets CORS headers.
  const allowAll = ALLOW_ORIGINS.includes('*');
  if (origin && (allowAll || originAllowed(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (allowAll) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Aurial-Token, X-Blob-Id');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Aurial-Title, X-Aurial-Cover, X-Aurial-Artist, X-Aurial-Track, X-Aurial-Album, X-Aurial-Uploader',
  );
  // Private Network Access: let an https public page reach this localhost helper.
  if (req.headers['access-control-request-private-network'])
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const log = (...a) => console.log('[aurial-importer]', ...a);

/**
 * Authorize a request. Firebase-gated when IMPORT_ALLOWED_EMAILS or
 * IMPORT_REQUIRE_LOGIN is set: a valid Firebase ID token with a verified email
 * is required (the URL alone grants nothing, no shared secret in the bundle).
 * With an allow-list only those emails pass; otherwise any signed-in user does.
 * Else falls back to the shared token; else open.
 */
async function authorize(req) {
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (FIREBASE_GATED) {
    if (!bearer) return false;
    try {
      const claims = await verifyFirebaseToken(bearer);
      if (!claims.email_verified) return false;
      if (ALLOWED_EMAILS.length === 0) return true; // any signed-in user
      return ALLOWED_EMAILS.includes(String(claims.email || '').toLowerCase());
    } catch {
      return false;
    }
  }
  if (IMPORT_TOKEN) return bearer === IMPORT_TOKEN || req.headers['x-aurial-token'] === IMPORT_TOKEN;
  return true;
}

async function main() {
  const ytdlp = await resolveYtdlp();
  log(`yt-dlp: ${ytdlp}`);
  await mkdir(BLOB_DIR, { recursive: true }).catch(() => undefined);

  const server = http.createServer((req, res) => {
    void (async () => {
      applyCors(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const { pathname } = new URL(req.url ?? '/', `http://localhost:${PORT}`);

      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            service: 'aurial-importer',
            hosts: HOSTS,
            authMode: FIREBASE_GATED ? 'firebase' : IMPORT_TOKEN ? 'token' : 'open',
          }),
        );
        return;
      }

      // ── Real artist photo lookup (Deezer, server-side to dodge CORS) ─────
      if (req.method === 'GET' && pathname === '/artist-image') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const name = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams.get('name');
        let imageUrl = null;
        let matched = null;
        if (name && name.trim()) {
          try {
            const r = await fetch(
              `https://api.deezer.com/search/artist?limit=1&q=${encodeURIComponent(name.trim())}`,
            );
            const d = await r.json().catch(() => ({}));
            const a = Array.isArray(d?.data) ? d.data[0] : null;
            if (a) {
              matched = a.name ?? null;
              imageUrl = a.picture_xl || a.picture_big || a.picture_medium || null;
              // Deezer returns a generic placeholder when it has no real photo.
              if (imageUrl && /\/artist\/?$|\/images\/artist\/\/?/.test(imageUrl)) imageUrl = null;
            }
          } catch {
            /* leave null */
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' });
        res.end(JSON.stringify({ imageUrl, name: matched }));
        return;
      }

      // ── Library blob store: upload once, stream from any device ──────────
      if (req.method === 'POST' && pathname === '/blob') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const id = req.headers['x-blob-id'];
        if (!safeBlobId(id)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id inválido.' }));
          return;
        }
        let buf;
        try {
          buf = await readBinaryBody(req, MAX_BLOB);
        } catch {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Arquivo grande demais.' }));
          return;
        }
        if (buf.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Corpo vazio.' }));
          return;
        }
        const token = crypto.randomBytes(16).toString('hex');
        const contentType = req.headers['content-type'] || 'audio/mpeg';
        try {
          await writeFile(blobPath(id), buf);
          await writeFile(blobMetaPath(id), JSON.stringify({ token, contentType, size: buf.length }));
        } catch (err) {
          log('blob write error:', err instanceof Error ? err.message : err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Falha ao salvar.' }));
          return;
        }
        log('blob stored:', id, `${(buf.length / 1024 / 1024).toFixed(1)}MB`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, token }));
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/blob/')) {
        const id = decodeURIComponent(pathname.slice('/blob/'.length));
        if (!safeBlobId(id)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('bad id');
          return;
        }
        let meta;
        try {
          meta = JSON.parse(await readFile(blobMetaPath(id), 'utf8'));
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
          return;
        }
        const k = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams.get('k');
        if (!k || k !== meta.token) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('forbidden');
          return;
        }
        let st;
        try {
          st = await stat(blobPath(id));
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
          return;
        }
        const total = st.size;
        const range = req.headers.range;
        let start = 0;
        let end = total - 1;
        let status = 200;
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          if (m) {
            if (m[1]) start = parseInt(m[1], 10);
            if (m[2]) end = parseInt(m[2], 10);
            if (Number.isNaN(start) || start > end || start >= total) {
              res.writeHead(416, { 'Content-Range': `bytes */${total}` });
              res.end();
              return;
            }
            status = 206;
          }
        }
        const headers = {
          'Content-Type': meta.contentType || 'audio/mpeg',
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=31536000',
        };
        if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
        res.writeHead(status, headers);
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const rs = createReadStream(blobPath(id), { start, end });
        rs.on('error', () => {
          if (!res.writableEnded) res.end();
        });
        rs.pipe(res);
        return;
      }

      if (req.method === 'DELETE' && pathname.startsWith('/blob/')) {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const id = decodeURIComponent(pathname.slice('/blob/'.length));
        if (!safeBlobId(id)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id inválido.' }));
          return;
        }
        await unlink(blobPath(id)).catch(() => undefined);
        await unlink(blobMetaPath(id)).catch(() => undefined);
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && pathname === '/stream') {
        const params = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams;
        const url = params.get('url');
        if (!(await authorizeToken(params.get('token')))) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('forbidden');
          return;
        }
        if (typeof url !== 'string' || !hostSupported(url)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('bad url');
          return;
        }
        const streamKbps = kbpsFor(params.get('quality'));
        log('stream:', url, `${streamKbps}k`);
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'no-store',
          'Accept-Ranges': 'none',
        });
        // yt-dlp (bestaudio → stdout) | ffmpeg (→ mp3 stream). Playback starts as
        // soon as the first frames arrive — no full download needed.
        const yt = spawn(
          ytdlp,
          [
            '-f',
            'bestaudio/best',
            '--no-playlist',
            '--no-warnings',
            ...(process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
            '-o',
            '-',
            url,
          ],
          {
            windowsHide: true,
        });
        const ff = spawn(
          FFMPEG_BIN,
          ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'mp3', '-b:a', `${streamKbps}k`, 'pipe:1'],
          { windowsHide: true },
        );
        let done = false;
        const cleanup = () => {
          if (done) return;
          done = true;
          try {
            yt.kill('SIGKILL');
          } catch {
            /* gone */
          }
          try {
            ff.kill('SIGKILL');
          } catch {
            /* gone */
          }
        };
        yt.on('error', cleanup);
        ff.on('error', cleanup);
        yt.stderr.on('data', () => {});
        ff.stderr.on('data', () => {});
        yt.stdout.on('error', () => {});
        ff.stdin.on('error', () => {}); // client may disconnect mid-pipe
        yt.stdout.pipe(ff.stdin);
        ff.stdout.pipe(res);
        ff.on('close', () => {
          if (!res.writableEnded) res.end();
          cleanup();
        });
        req.on('close', cleanup);
        return;
      }

      if (req.method === 'POST' && pathname === '/playlist') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado. Entre na sua conta para importar.' }));
          return;
        }
        try {
          const { url } = JSON.parse((await readBody(req)) || '{}');
          if (typeof url !== 'string' || !hostSupported(url)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Link não suportado.' }));
            return;
          }
          log('playlist:', url);
          const result = await listPlaylist(ytdlp, url);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Falha ao ler a playlist.';
          log('playlist error:', message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
        }
        return;
      }

      // Real song metadata for a link WITHOUT downloading — to re-identify tracks.
      if (req.method === 'POST' && pathname === '/meta') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        try {
          const { url } = JSON.parse((await readBody(req)) || '{}');
          if (typeof url !== 'string' || !hostSupported(url)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Link não suportado.' }));
            return;
          }
          const info = await dumpJson(ytdlp, url);
          const rawArtist = Array.isArray(info.artists)
            ? info.artists.join(', ')
            : info.artist || info.creator || '';
          const rawUploader = info.uploader || info.channel || '';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              title: typeof info.title === 'string' ? info.title : null,
              artist: typeof rawArtist === 'string' && rawArtist.trim() ? rawArtist.trim() : null,
              track: typeof info.track === 'string' ? info.track : null,
              album: typeof info.album === 'string' ? info.album : null,
              thumbnail: typeof info.thumbnail === 'string' ? info.thumbnail : null,
              uploader:
                typeof rawUploader === 'string' && rawUploader.trim() ? rawUploader.trim() : null,
            }),
          );
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Falha.' }));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/ai/chat') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        if (!NVIDIA_API_KEY) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'IA não configurada no servidor.' }));
          return;
        }
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          const messages = Array.isArray(body.messages) ? body.messages : [];
          if (messages.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'messages obrigatório.' }));
            return;
          }
          const upstream = await fetch(`${NVIDIA_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${NVIDIA_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: typeof body.model === 'string' ? body.model : NVIDIA_MODEL,
              messages,
              max_tokens: Math.min(Number(body.max_tokens) || 512, 4096),
              temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
              stream: false,
            }),
          });
          const data = await upstream.json().catch(() => ({}));
          const content = data?.choices?.[0]?.message?.content ?? '';
          res.writeHead(upstream.ok ? 200 : 502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(upstream.ok ? { content } : { error: 'Falha na IA.' }));
        } catch (err) {
          log('ai error:', err instanceof Error ? err.message : err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Falha na IA.' }));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/import') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado. Entre na sua conta para importar.' }));
          return;
        }
        let job;
        try {
          const { url, quality } = JSON.parse((await readBody(req)) || '{}');
          if (typeof url !== 'string' || !hostSupported(url)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Link não suportado.' }));
            return;
          }
          log('import:', url, `${kbpsFor(quality)}k`);
          job = await importToMp3(ytdlp, url, quality);
          const { size } = await stat(job.file);
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(size),
            'X-Aurial-Title': encodeURIComponent(job.title),
            ...(job.thumbnail ? { 'X-Aurial-Cover': encodeURIComponent(job.thumbnail) } : {}),
            ...(job.artist ? { 'X-Aurial-Artist': encodeURIComponent(job.artist) } : {}),
            ...(job.track ? { 'X-Aurial-Track': encodeURIComponent(job.track) } : {}),
            ...(job.album ? { 'X-Aurial-Album': encodeURIComponent(job.album) } : {}),
            ...(job.uploader ? { 'X-Aurial-Uploader': encodeURIComponent(job.uploader) } : {}),
          });
          const { createReadStream } = await import('node:fs');
          await new Promise((resolve, reject) => {
            const rs = createReadStream(job.file);
            rs.on('error', reject);
            res.on('finish', resolve);
            rs.pipe(res);
          });
          log('done:', job.title);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Falha na importação.';
          log('error:', message);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
          } else {
            res.destroy();
          }
        } finally {
          if (job?.dir) await rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    })();
  });

  server.listen(PORT, HOST, () => {
    log(`listening on http://${HOST}:${PORT}`);
    log(`allowed origins: ${ALLOW_ORIGINS.join(', ')}`);
    log('⚠️  Personal use only — import only content you are authorized to download.');
  });
}

main().catch((err) => {
  console.error('[aurial-importer] fatal:', err);
  process.exit(1);
});
