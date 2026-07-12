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
 * Env:  PORT (default 8787) · YTDLP_PATH · FFMPEG_PATH · ALLOW_ORIGIN (csv)
 *       AURIAL_MAX_MINUTES (default 90)
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, chmod } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8787);
// Bind address. Default localhost (safest). Set HOST=0.0.0.0 to reach it from
// other devices on your LAN / Tailscale (see README — mind the exposure).
const HOST = process.env.HOST ?? '127.0.0.1';
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
// this localhost helper). Override with ALLOW_ORIGIN=csv.
const ALLOW_ORIGINS = (
  process.env.ALLOW_ORIGIN ??
  'http://localhost:5173,http://127.0.0.1:5173,https://aurial.vercel.app'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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
async function importToMp3(ytdlp, url) {
  const dir = await mkdtemp(path.join(tmpdir(), 'aurial-import-'));
  const args = [
    '--no-playlist',
    '--no-progress',
    '--no-warnings',
    '-f',
    'bestaudio/best',
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0',
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
  try {
    const info = JSON.parse(await readFile(path.join(dir, 'audio.info.json'), 'utf8'));
    if (typeof info.title === 'string' && info.title.trim()) title = info.title.trim();
  } catch {
    /* keep default */
  }
  return { dir, file: path.join(dir, mp3), title };
}

function interpret(stderr) {
  const s = stderr.toLowerCase();
  if (s.includes('private video') || s.includes('sign in') || s.includes('login'))
    return 'Conteúdo privado ou exige login.';
  if (s.includes('video unavailable') || s.includes('removed')) return 'Conteúdo indisponível.';
  if (s.includes('unsupported url') || s.includes('unable to extract'))
    return 'Link não suportado.';
  return 'Não foi possível baixar desse link.';
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-Aurial-Title');
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

async function main() {
  const ytdlp = await resolveYtdlp();
  log(`yt-dlp: ${ytdlp}`);

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
        res.end(JSON.stringify({ ok: true, service: 'aurial-importer', hosts: HOSTS }));
        return;
      }

      if (req.method === 'POST' && pathname === '/import') {
        let job;
        try {
          const { url } = JSON.parse((await readBody(req)) || '{}');
          if (typeof url !== 'string' || !hostSupported(url)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Link não suportado.' }));
            return;
          }
          log('import:', url);
          job = await importToMp3(ytdlp, url);
          const { size } = await stat(job.file);
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(size),
            'X-Aurial-Title': encodeURIComponent(job.title),
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
