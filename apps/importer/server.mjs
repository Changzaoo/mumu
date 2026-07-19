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
 *       AURIAL_MAX_MINUTES (default 90) · IMPORT_ALLOWED_EMAILS (csv allow-list,
 *       verified emails only) · IMPORT_REQUIRE_LOGIN (1 = any Firebase account
 *       with an email — verified or not; anonymous blocked) · IMPORT_TOKEN
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
import {
  timestampsAreDegenerate,
  toWav16k,
  transcribeConfigured,
  transcribeWords,
} from './riva.mjs';

const PORT = Number(process.env.PORT ?? 8787);
// Bind address. Default localhost (safest). Set HOST=0.0.0.0 to reach it from
// other devices on your LAN / Tailscale (see README — mind the exposure).
const HOST = process.env.HOST ?? '127.0.0.1';
// Optional shared secret (legacy fallback). Prefer Firebase gating below.
const IMPORT_TOKEN = (process.env.IMPORT_TOKEN ?? '').trim();

// ── Firebase auth gate ──────────────────────────────────────────────────────
// Two Firebase-gated modes, both requiring a valid Firebase ID token (knowing
// the URL grants nothing, and no shared secret ships in the browser bundle):
//   • IMPORT_ALLOWED_EMAILS set → only those emails may import, and they must
//     be VERIFIED (strict: it's an owner allow-list).
//   • IMPORT_REQUIRE_LOGIN=1    → any signed-in user whose token carries an
//     email claim may import. Email verification is NOT required here: an
//     unverified email/password account is still a legitimate registered user,
//     and requiring verification made those accounts (and their persisted
//     import queues) hit 403 forever. Anonymous sign-ins have no email claim,
//     so they stay blocked.
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

// ── stale temp sweep ─────────────────────────────────────────────────────────
// /tmp is a SMALL tmpfs (RAM) on the home server. Imports killed mid-flight
// (restarts, crashes) leave their work dirs behind; enough of them fill the
// tmpfs and EVERY download starts failing with "Disk quota exceeded". Sweep
// anything of ours older than an hour, at boot and periodically.
async function sweepStaleTmp() {
  try {
    const base = tmpdir();
    const cutoff = Date.now() - 3600_000;
    for (const name of await readdir(base)) {
      if (!name.startsWith('aurial-import-') && !name.startsWith('_MEI')) continue;
      const p = path.join(base, name);
      try {
        const st = await stat(p);
        if (st.mtimeMs < cutoff) await rm(p, { recursive: true, force: true });
      } catch {
        /* raced with an active import — leave it */
      }
    }
  } catch {
    /* tmpdir unreadable — nothing to sweep */
  }
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
    // Fragmentos em paralelo: o download do áudio em si fica ~3-4× mais
    // rápido (fetches de CDN, não contam como "requests" na página).
    '--concurrent-fragments',
    '4',
    // Pausas menores: o cliente já recua sozinho (modo devagar) se o YouTube
    // pedir verificação — não precisamos pagar 3-8s de pausa em TODA faixa.
    '--sleep-requests',
    '0.5',
    '--sleep-interval',
    '1',
    '--max-sleep-interval',
    '3',
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

/**
 * Erro PERMANENTE da faixa (vídeo removido/privado/não suportado): re-tentar
 * nunca resolve. O /import devolve 422 nesses casos para o app marcar o item
 * como erro definitivo sem retry — e sem pausar a fila inteira por causa de
 * meia dúzia de vídeos mortos no meio de uma playlist grande.
 */
function isPermanentImportError(message) {
  return (
    message === 'Conteúdo privado ou exige login.' ||
    message === 'Conteúdo indisponível.' ||
    message === 'Link não suportado.' ||
    message.startsWith('Sem áudio')
  );
}

// ── Import por JOB (start → status → arquivo) ────────────────────────────────
// O POST /import clássico não emite NENHUM byte até o MP3 ficar pronto; atrás
// do Cloudflare, respostas mudas por ~100s morrem com 524 e o cliente perde
// todo o progresso do download. Com jobs: o start responde na hora, o status é
// uma consulta leve (imune a timeout) e o arquivo pronto desce numa
// transferência curta. A rede do cliente pode até piscar no meio — o job segue
// vivo no servidor e o download não recomeça do zero.
const importJobs = new Map(); // id → job
const JOB_TTL_MS = 60 * 60_000; // 1h — igual ao sweep de /tmp

function startImportJob(url, quality) {
  const id = crypto.randomUUID();
  const job = {
    status: 'running', // 'running' | 'done' | 'error'
    error: null,
    permanent: false,
    dir: null,
    file: null,
    meta: null,
    createdAt: Date.now(),
  };
  importJobs.set(id, job);
  log('import job:', id.slice(0, 8), url, `${kbpsFor(quality)}k`);
  void importToMp3(ytdlpBin, url, quality)
    .then(async (r) => {
      job.dir = r.dir;
      job.file = r.file;
      const { size } = await stat(r.file);
      job.meta = {
        title: r.title,
        coverUrl: r.thumbnail || null,
        artist: r.artist || null,
        track: r.track || null,
        album: r.album || null,
        uploader: r.uploader || null,
        size,
      };
      job.status = 'done';
      log('job done:', r.title);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : 'Falha na importação.';
      job.status = 'error';
      job.error = message;
      job.permanent = isPermanentImportError(message);
      log('job error:', message);
    });
  return id;
}

function dropImportJob(id) {
  const job = importJobs.get(id);
  if (!job) return;
  importJobs.delete(id);
  if (job.dir) void rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
}

function sweepImportJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of importJobs) {
    if (job.createdAt < cutoff) dropImportJob(id);
  }
}

// startImportJob roda fora do handler (sem acesso ao `ytdlp` do main) — o
// binário resolvido é publicado aqui uma única vez no boot.
let ytdlpBin = 'yt-dlp';

// Max playlist entries returned in one enumeration (0 = unlimited). Flat
// enumeration is cheap (no per-video extraction), so the cap is generous —
// the old default (200) silently truncated big playlists (1132 → 200).
const MAX_PLAYLIST = Number(process.env.AURIAL_MAX_PLAYLIST ?? 5000);

// ── NVIDIA AI proxy (key stays server-side) ─────────────────────────────────
const NVIDIA_API_KEY = (process.env.NVIDIA_API_KEY ?? '').trim();
const NVIDIA_BASE = (process.env.NVIDIA_BASE ?? 'https://integrate.api.nvidia.com/v1').replace(
  /\/$/,
  '',
);
const NVIDIA_MODEL = process.env.NVIDIA_MODEL ?? 'meta/llama-3.1-8b-instruct';
// Embeddings multilíngues (26 idiomas, inclui pt-BR) — 2048 dims, contexto 8k.
const NVIDIA_EMBED_MODEL =
  process.env.NVIDIA_EMBED_MODEL ?? 'nvidia/llama-nemotron-embed-1b-v2';
// A NVIDIA não documenta o teto de lote do endpoint hospedado; 32 é
// conservador o bastante para não tomar 4xx e grande o bastante para não
// transformar uma biblioteca em centenas de requisições.
const EMBED_MAX_BATCH = Number(process.env.NVIDIA_EMBED_BATCH ?? 32);
/** Teto do áudio aceito para transcrição (uma música cabe folgada em 40 MB). */
const MAX_TRANSCRIBE_BYTES = Number(process.env.MAX_TRANSCRIBE_MB ?? 40) * 1024 * 1024;

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

// ── cofre de blobs em DISCO EXTERNO + teto LRU ──────────────────────────────
// Com BLOB_DIR apontando para o USB, exigimos um arquivo-marcador dentro dele:
// se o USB cair, o mountpoint vira um diretório vazio no disco RAIZ — sem o
// marcador, gravações são recusadas (503) em vez de encher a raiz de novo.
const BLOB_DIR_EXTERNAL = Boolean(process.env.BLOB_DIR);
const BLOB_MARKER = path.join(BLOB_DIR, '.aurial-blobs');
// Teto do cofre (LRU): ao passar, os blobs MAIS ANTIGOS saem primeiro. São
// cópias para streaming entre aparelhos — o original continua no aparelho do
// dono e a faixa segue tocável via streaming ao vivo da fonte.
const MAX_BLOB_BYTES = Number(process.env.MAX_BLOB_GB ?? 15) * 1024 ** 3;

async function blobStoreReady() {
  if (!BLOB_DIR_EXTERNAL) return true;
  try {
    await stat(BLOB_MARKER);
    return true;
  } catch {
    return false;
  }
}

async function sweepBlobStore() {
  try {
    if (!(await blobStoreReady())) return;
    const names = await readdir(BLOB_DIR);
    const bins = [];
    let total = 0;
    for (const name of names) {
      if (!name.endsWith('.bin')) continue;
      const p = path.join(BLOB_DIR, name);
      const st = await stat(p).catch(() => null);
      if (!st) continue;
      bins.push({ p, size: st.size, mtime: st.mtimeMs });
      total += st.size;
    }
    if (total <= MAX_BLOB_BYTES) return;
    bins.sort((a, b) => a.mtime - b.mtime); // mais antigos primeiro
    for (const b of bins) {
      if (total <= MAX_BLOB_BYTES) break;
      await rm(b.p, { force: true }).catch(() => undefined);
      await rm(b.p.replace(/\.bin$/, '.json'), { force: true }).catch(() => undefined);
      total -= b.size;
    }
    log(`blob LRU: cofre reduzido para ${(total / 1024 ** 3).toFixed(1)}GB`);
  } catch {
    /* diretório ilegível — nada a varrer */
  }
}
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
 * Descarta o corpo que ainda está subindo, e SÓ ENTÃO responde.
 *
 * Recusar um upload sem ler o corpo parece inofensivo, mas não é: o navegador
 * ainda está mandando megabytes quando o servidor encerra a resposta, e sob
 * HTTP/2 (que é o que a Cloudflare fala) isso derruba o stream. O cliente não
 * recebe o 403/413 que explicaria tudo — recebe `ERR_HTTP2_PROTOCOL_ERROR`, um
 * erro de transporte que não diz nada. Foi assim que um upload recusado virou
 * "a faixa não toca no celular": sem a cópia enviada, o outro aparelho fica sem
 * fonte, e a causa real nunca aparecia em lugar nenhum.
 *
 * Espera no máximo `timeoutMs` — corpo grande em conexão lenta não pode segurar
 * a resposta de erro para sempre.
 */
function drainBody(req, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    if (req.readableEnded || req.method === 'GET' || req.method === 'HEAD') {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    req.on('data', () => undefined); // consome e descarta
    req.on('end', done);
    req.on('error', done);
  });
}

/** Recusa um upload de forma legível: drena, depois responde com o status. */
async function rejectUpload(req, res, status, payload) {
  await drainBody(req);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
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
      // A registered account always carries an email claim; anonymous sign-ins
      // don't — this alone blocks them.
      if (!claims.email) return false;
      // REQUIRE_LOGIN mode: any registered user, verified or not (an unverified
      // email/password account is a legitimate user, not an attacker).
      if (ALLOWED_EMAILS.length === 0) return true;
      // Allow-list mode stays strict: the email must be verified AND listed.
      if (!claims.email_verified) return false;
      return ALLOWED_EMAILS.includes(String(claims.email).toLowerCase());
    } catch {
      return false;
    }
  }
  if (IMPORT_TOKEN) return token === IMPORT_TOKEN;
  return true;
}

/** Dump a single video's full metadata JSON WITHOUT downloading the media. */
async function dumpJson(ytdlp, url) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--skip-download',
    '--dump-single-json',
    // A extração COMPLETA é justamente o caminho que o YouTube barra com
    // "confirme que você não é um robô" — e era o único que não passava os
    // cookies, ao contrário de listPlaylist e importToMp3. Sem isto, a leitura
    // de metadados falha primeiro que o download, que é o inverso do esperado.
    ...(process.env.YTDLP_COOKIES ? ['--cookies', process.env.YTDLP_COOKIES] : []),
    url,
  ];
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
    ...(MAX_PLAYLIST > 0 ? ['--playlist-end', String(MAX_PLAYLIST)] : []),
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

/**
 * Corpo BINÁRIO (áudio para transcrição). O readBody acima concatena em
 * string, o que corromperia bytes — e o teto de 1 MB não serve para uma
 * música. Aqui juntamos Buffers e cortamos no limite informado.
 */
function readBodyBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error('áudio grande demais'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const log = (...a) => console.log('[aurial-importer]', ...a);

/**
 * Authorize a request. Firebase-gated when IMPORT_ALLOWED_EMAILS or
 * IMPORT_REQUIRE_LOGIN is set: a valid Firebase ID token carrying an email
 * claim is required (the URL alone grants nothing, no shared secret in the
 * bundle; anonymous sign-ins have no email claim and are blocked). With an
 * allow-list only those emails pass and they must be VERIFIED; in plain
 * REQUIRE_LOGIN mode any registered user passes — verified or not, since an
 * unverified email/password account is a legitimate user and rejecting it
 * left clients in a permanent 403 retry loop.
 * Else falls back to the shared token; else open.
 */
async function authorize(req) {
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (FIREBASE_GATED) {
    if (!bearer) return false;
    try {
      const claims = await verifyFirebaseToken(bearer);
      // Anonymous accounts carry no email claim → blocked here.
      if (!claims.email) return false;
      // REQUIRE_LOGIN mode: any registered user (verified or not).
      if (ALLOWED_EMAILS.length === 0) return true;
      // Allow-list mode stays strict: verified AND listed.
      if (!claims.email_verified) return false;
      return ALLOWED_EMAILS.includes(String(claims.email).toLowerCase());
    } catch {
      return false;
    }
  }
  if (IMPORT_TOKEN) return bearer === IMPORT_TOKEN || req.headers['x-aurial-token'] === IMPORT_TOKEN;
  return true;
}

// ── Capa & créditos (Deezer + MusicBrainz/Cover Art Archive) ──────────────────
// Por que aqui e não no navegador: a api.deezer.com não manda cabeçalho de CORS
// (chamada direta morre no preflight) e a MusicBrainz exige User-Agent próprio +
// no máximo 1 requisição por segundo — um teto que só dá para respeitar num
// ponto único, com fila. O token do Firebase nunca sai daqui para esses hosts.
const MB_ROOT = 'https://musicbrainz.org/ws/2';
const MB_USER_AGENT = 'Aurial/1.0 ( perdibitcoin@gmail.com )';
const MB_MIN_INTERVAL_MS = 1100; // 1 req/s + folga; abusar rende bloqueio de IP
const COVER_FETCH_TIMEOUT_MS = 8000;

const normText = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// "Chitãozinho & Xororó" vs "Chitaozinho e Xororo": o conectivo no meio quebra
// qualquer comparação por prefixo/substring, e dupla com conectivo é a regra no
// catálogo brasileiro. Derrubar esses tokens é o que faz a dupla casar.
const CONNECTORS = new Set(['e', 'and', 'feat', 'ft', 'with', 'com', 'y']);

const normArtist = (s) =>
  normText(s)
    .split(' ')
    .filter((token) => token && !CONNECTORS.has(token))
    .join(' ');

/**
 * Quanto uma linha do catálogo se parece com o que procuramos (0 = descarta).
 * Título E artista precisam bater — só título casa "Evidências" de qualquer um,
 * e capa errada é pior que capa nenhuma (o usuário confia no que vê).
 */
function matchScore(row, wantTitle, wantArtist) {
  const t = normText(row.title);
  const a = normArtist(row.artist);
  const wt = normText(wantTitle);
  const wa = normArtist(wantArtist);
  if (!t || !wt) return 0;
  const titleScore = t === wt ? 3 : t.startsWith(wt) || wt.startsWith(t) ? 2 : 0;
  if (titleScore === 0) return 0;
  if (!wa) return titleScore; // sem artista para conferir, o título decide sozinho
  const artistScore = a === wa ? 3 : a.includes(wa) || wa.includes(a) ? 2 : 0;
  if (artistScore === 0) return 0;
  return titleScore + artistScore;
}

// Fila serial da MusicBrainz: cada chamada espera a anterior + o intervalo
// mínimo. Sem isto, duas faixas em paralelo já estouram o limite e a API passa a
// devolver 503 para todo mundo.
let mbChain = Promise.resolve();
let mbLastAt = 0;

function mbFetch(path) {
  const run = async () => {
    const wait = mbLastAt + MB_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    mbLastAt = Date.now();
    try {
      const r = await fetch(`${MB_ROOT}/${path}`, {
        headers: { 'User-Agent': MB_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS),
      });
      if (!r.ok) return null; // 404 (não catalogado) e 503 (limite) são normais aqui
      return await r.json();
    } catch {
      return null;
    }
  };
  // Encadeia SEM propagar rejeição: uma falha não pode travar a fila inteira.
  const result = mbChain.then(run, run);
  mbChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Capa do Deezer para título+artista (consulta SOLTA — a sintaxe estrita
 *  `track:"x" artist:"y"` não acha catálogo regional). */
async function deezerCover(title, artist) {
  const q = [artist, title].filter(Boolean).join(' ').trim();
  if (!q) return null;
  const r = await fetch(
    `https://api.deezer.com/search?limit=5&q=${encodeURIComponent(q)}`,
    { signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS) },
  );
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  const rows = Array.isArray(d?.data) ? d.data : [];
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const score = matchScore(
      { title: row?.title_short || row?.title, artist: row?.artist?.name },
      title,
      artist,
    );
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (!best) return null;
  const cover = best?.album?.cover_xl || best?.album?.cover_big || best?.album?.cover_medium || null;
  if (!cover) return null;
  return {
    coverUrl: cover,
    album: best?.album?.title ?? null,
    artist: best?.artist?.name ?? null,
    title: best?.title ?? null,
  };
}

/** Catálogo de artista é caro (1 + N chamadas) e praticamente imutável — vale
 *  guardar por um dia. Chave: nome em minúsculas. */
const artistCatalogCache = new Map();
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
/** Teto de álbuns por perfil: um artista prolífico não pode virar 300 chamadas. */
const CATALOG_ALBUM_LIMIT = 60;

/**
 * Todas as faixas de todos os perfis que casam o nome EXATO do artista.
 *
 * Homônimo aqui é feature, não bug: "Alee" tem 6 perfis no Deezer e as faixas
 * do usuário estão espalhadas entre eles. Diferente de /artist-top — que
 * precisa de UM artista para ranquear — aqui só interessa o conjunto de
 * faixas, então juntar tudo só aumenta a chance de casar. O falso positivo é
 * barrado depois, no cliente, pela duração.
 */
async function deezerArtistCatalog(name) {
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const wanted = norm(name);
  const jf = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS) });
    return r.ok ? r.json().catch(() => ({})) : {};
  };

  const found = await jf(
    `https://api.deezer.com/search/artist?limit=10&q=${encodeURIComponent(name)}`,
  );
  const profiles = (Array.isArray(found?.data) ? found.data : []).filter(
    (a) => a?.id && typeof a.name === 'string' && norm(a.name) === wanted,
  );

  const out = [];
  const seen = new Set();
  for (const profile of profiles) {
    const albums = await jf(`https://api.deezer.com/artist/${profile.id}/albums?limit=100`);
    const list = (Array.isArray(albums?.data) ? albums.data : []).slice(0, CATALOG_ALBUM_LIMIT);
    for (const album of list) {
      if (!album?.id) continue;
      const full = await jf(`https://api.deezer.com/album/${album.id}`);
      const cover = full?.cover_xl || full?.cover_big || album?.cover_xl || album?.cover_big || null;
      for (const t of Array.isArray(full?.tracks?.data) ? full.tracks.data : []) {
        if (!t || typeof t.title !== 'string') continue;
        const key = `${norm(t.title)}|${t.duration ?? 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          title: t.title,
          artist: t?.artist?.name ?? profile.name,
          album: full?.title ?? album?.title ?? null,
          // Segundos, como a Deezer entrega; o cliente converte.
          duration: typeof t.duration === 'number' ? t.duration : null,
          cover,
        });
      }
    }
  }
  return out;
}

/**
 * Ficha técnica pela MusicBrainz: gravadora, número de catálogo e compositor.
 * É a ÚNICA fonte gratuita desses três campos — o iTunes e o Deezer não os
 * expõem. A capa (Cover Art Archive) vem de brinde, como último recurso.
 * Compositor exige dois saltos: gravação → obra → pessoas creditadas na obra.
 */
async function musicbrainzCredits(title, artist) {
  const query = artist
    ? `artist:"${artist.replace(/"/g, '')}" AND recording:"${title.replace(/"/g, '')}"`
    : `recording:"${title.replace(/"/g, '')}"`;
  const found = await mbFetch(
    `recording?query=${encodeURIComponent(query)}&fmt=json&limit=3&inc=releases`,
  );
  const recordings = Array.isArray(found?.recordings) ? found.recordings : [];
  let best = null;
  let bestScore = 0;
  for (const rec of recordings) {
    const score = matchScore(
      { title: rec?.title, artist: rec?.['artist-credit']?.[0]?.name },
      title,
      artist,
    );
    if (score > bestScore) {
      bestScore = score;
      best = rec;
    }
  }
  if (!best) return null;

  const releaseId = Array.isArray(best.releases) ? best.releases[0]?.id : null;
  let label = null;
  let catalogNumber = null;
  let coverUrl = null;
  if (releaseId) {
    coverUrl = `https://coverartarchive.org/release/${releaseId}/front-500`;
    const release = await mbFetch(`release/${releaseId}?inc=labels&fmt=json`);
    const info = Array.isArray(release?.['label-info']) ? release['label-info'][0] : null;
    label = info?.label?.name ?? null;
    catalogNumber = info?.['catalog-number'] ?? null;
  }

  // Salto 1: a gravação aponta para a OBRA (a composição, não esta execução).
  const rec = await mbFetch(`recording/${best.id}?inc=work-rels&fmt=json`);
  const workId = (Array.isArray(rec?.relations) ? rec.relations : []).find(
    (rel) => rel?.['target-type'] === 'work',
  )?.work?.id;
  let composer = null;
  if (workId) {
    // Salto 2: a obra aponta para quem a escreveu (composer/lyricist/writer).
    const work = await mbFetch(`work/${workId}?inc=artist-rels&fmt=json`);
    const people = (Array.isArray(work?.relations) ? work.relations : [])
      .filter((rel) => ['composer', 'lyricist', 'writer'].includes(rel?.type))
      .map((rel) => rel?.artist?.name)
      .filter(Boolean);
    if (people.length > 0) composer = [...new Set(people)].join(', ');
  }

  if (!label && !catalogNumber && !composer && !coverUrl) return null;
  return { label, catalogNumber, composer, coverUrl };
}

async function main() {
  const ytdlp = await resolveYtdlp();
  ytdlpBin = ytdlp; // publica para os import-jobs (rodam fora deste escopo)
  log(`yt-dlp: ${ytdlp}`);
  // Diretório local padrão pode ser criado; o EXTERNO nunca (mkdir num
  // mountpoint desmontado criaria a pasta no disco raiz).
  if (!BLOB_DIR_EXTERNAL) await mkdir(BLOB_DIR, { recursive: true }).catch(() => undefined);
  else log(`blob store externo: ${BLOB_DIR} (${(await blobStoreReady()) ? 'ok' : 'INDISPONÍVEL'})`);
  void sweepStaleTmp();
  void sweepBlobStore();
  setInterval(() => void sweepStaleTmp(), 3600_000).unref();
  setInterval(() => void sweepBlobStore(), 3600_000).unref();
  setInterval(() => sweepImportJobs(), 600_000).unref();

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
            // Capabilities the web app gates on — the metadata-team healing pass
            // must NOT run against an old importer that lacks these fields.
            caps: ['uploader', 'album', 'quality', 'jobs', 'cover', 'credits'],
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

      // ── Top do artista (Deezer, server-side p/ evitar CORS) ─────────────
      // A Deezer devolve as faixas JÁ ordenadas por popularidade real (campo
      // `rank`), que é o que o usuário quer ver primeiro na página do artista —
      // popularidade do mundo, não o histórico dele. Sem este proxy o navegador
      // não consegue chamar: a api.deezer.com não manda cabeçalho de CORS.
      if (req.method === 'GET' && pathname === '/artist-top') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const name = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams.get('name');
        const normStr = (s) =>
          String(s)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        let artist = null;
        let tracks = [];
        if (name && name.trim()) {
          try {
            const r = await fetch(
              `https://api.deezer.com/search/artist?limit=10&q=${encodeURIComponent(name.trim())}`,
            );
            const d = await r.json().catch(() => ({}));
            const list = Array.isArray(d?.data) ? d.data : [];
            // Homônimo é a regra, não a exceção: existem vários "Anitta" no
            // Deezer e o primeiro resultado pode ser um perfil com 155 fãs. Fica
            // com quem casa o nome EXATO e tem mais fãs — o artista de verdade.
            const wanted = normStr(name);
            const named = list.filter((x) => x && typeof x.name === 'string');
            const exact = named.filter((x) => normStr(x.name) === wanted);
            const a = (exact.length ? exact : named).sort(
              (x, y) => (y.nb_fan ?? 0) - (x.nb_fan ?? 0),
            )[0];
            if (a?.id) {
              artist = {
                id: a.id,
                name: a.name ?? null,
                picture: a.picture_xl || a.picture_big || a.picture_medium || null,
                nb_fan: typeof a.nb_fan === 'number' ? a.nb_fan : null,
              };
              const tr = await fetch(`https://api.deezer.com/artist/${a.id}/top?limit=50`);
              const top = await tr.json().catch(() => ({}));
              tracks = (Array.isArray(top?.data) ? top.data : [])
                .filter((t) => t && typeof t.title === 'string')
                .map((t) => ({
                  title: t.title,
                  rank: typeof t.rank === 'number' ? t.rank : 0,
                  album: t?.album?.title ?? null,
                  duration: typeof t.duration === 'number' ? t.duration : null,
                }));
            }
          } catch (err) {
            log(`artist-top falhou para "${name}": ${err?.message ?? err}`);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' });
        res.end(JSON.stringify({ artist, tracks }));
        return;
      }

      // ── Album lookup ("lente" de álbum — Deezer, server-side p/ evitar CORS) ──
      // Given an album title (+ optional artist hint), find the REAL album and
      // return its authoritative artist, hi-res cover and full tracklist. The
      // web app's VERIFICADOR only adopts it when the track title is actually
      // in the tracklist — two independent proofs, zero guessing.
      if (req.method === 'GET' && pathname === '/album') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const sp = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams;
        const title = (sp.get('title') || '').trim();
        const artistHint = (sp.get('artist') || '').trim();
        const normStr = (s) =>
          String(s)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        let payload = null;
        if (title) {
          try {
            const q = [title, artistHint].filter(Boolean).join(' ');
            const r = await fetch(
              `https://api.deezer.com/search/album?limit=5&q=${encodeURIComponent(q)}`,
            );
            const d = await r.json().catch(() => ({}));
            const list = Array.isArray(d?.data) ? d.data : [];
            const want = normStr(title);
            const titled = list.filter((a) => a && typeof a.title === 'string');
            const hit =
              titled.find((a) => normStr(a.title) === want) ??
              titled.find(
                (a) => normStr(a.title).startsWith(want) || want.startsWith(normStr(a.title)),
              );
            if (hit?.id) {
              const ar = await fetch(`https://api.deezer.com/album/${hit.id}`);
              const album = await ar.json().catch(() => ({}));
              const tracks = Array.isArray(album?.tracks?.data)
                ? album.tracks.data
                    .map((t) => (t && typeof t.title === 'string' ? t.title : ''))
                    .filter(Boolean)
                : [];
              payload = {
                title: typeof album.title === 'string' ? album.title : hit.title,
                artist: album?.artist?.name ?? hit?.artist?.name ?? null,
                coverUrl:
                  album.cover_xl || album.cover_big || hit.cover_xl || hit.cover_big || null,
                tracks,
              };
            }
          } catch {
            /* leave null */
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' });
        res.end(JSON.stringify({ album: payload }));
        return;
      }

      // ── Capa por título+artista (Deezer, server-side p/ evitar CORS) ─────
      // Segunda tentativa da varredura de capas, depois do iTunes. O Deezer
      // cobre catálogo brasileiro que a Apple não expõe sem preview.
      if (req.method === 'GET' && pathname === '/cover') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const sp = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams;
        const title = (sp.get('title') || '').trim();
        const artist = (sp.get('artist') || '').trim();
        let payload = null;
        if (title) {
          try {
            payload = await deezerCover(title, artist);
          } catch (err) {
            log(`cover falhou para "${title}": ${err?.message ?? err}`);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' });
        res.end(JSON.stringify(payload ?? { coverUrl: null, album: null, artist: null, title: null }));
        return;
      }

      // ── Catálogo COMPLETO do artista (Deezer, server-side p/ evitar CORS) ─
      // Por que existe, se /cover já busca capa: buscar faixa a faixa é uma
      // loteria quando a faixa não tem artista. "CAROLINA" sozinho no Deezer
      // devolve o Ninho; "CEO" devolve o SCH. O acervo do usuário veio do
      // YouTube em lotes por artista, então a pergunta certa não é "quem canta
      // isso?" e sim "essa faixa está no catálogo do Brandão85?" — e aí título
      // + duração conferem a identidade sem chute. Medido no acervo real:
      // 52 de 55 faixas anônimas identificadas.
      //
      // Dois detalhes que /artist-top erra e este acerta:
      //  • /top devolve no máximo ~100 e só as populares; álbuns dão o catálogo
      //    inteiro, que é onde moram as faixas obscuras — justamente as que
      //    chegam sem metadado.
      //  • ficar com UM perfil (o de mais fãs) perdeu o Alee: ele tem 6 perfis
      //    homônimos no Deezer, e o mais popular tinha 1 faixa. Junta todos.
      if (req.method === 'GET' && pathname === '/artist-catalog') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const name = (
          new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams.get('name') || ''
        ).trim();
        let tracks = [];
        if (name) {
          const cached = artistCatalogCache.get(name.toLowerCase());
          if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
            tracks = cached.tracks;
          } else {
            try {
              tracks = await deezerArtistCatalog(name);
              artistCatalogCache.set(name.toLowerCase(), { at: Date.now(), tracks });
            } catch (err) {
              log(`artist-catalog falhou para "${name}": ${err?.message ?? err}`);
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' });
        res.end(JSON.stringify({ tracks }));
        return;
      }

      // ── Ficha técnica (MusicBrainz + Cover Art Archive) ──────────────────
      // Gravadora, número de catálogo e compositor não existem em nenhuma das
      // outras fontes. A capa vem junto, como ÚLTIMO recurso da varredura.
      if (req.method === 'GET' && pathname === '/credits') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const sp = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams;
        const title = (sp.get('title') || '').trim();
        const artist = (sp.get('artist') || '').trim();
        let payload = null;
        if (title) {
          try {
            payload = await musicbrainzCredits(title, artist);
          } catch (err) {
            log(`credits falhou para "${title}": ${err?.message ?? err}`);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' });
        res.end(
          JSON.stringify(
            payload ?? { label: null, catalogNumber: null, composer: null, coverUrl: null },
          ),
        );
        return;
      }

      // ── Network speed probe (admin telemetry) ────────────────────────────
      // GET  /speed?bytes=N → N random bytes (timed by the client = download).
      // POST /speed         → swallow the body, ack its size (= upload).
      if (pathname === '/speed' && (req.method === 'GET' || req.method === 'POST')) {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        if (req.method === 'POST') {
          let received = 0;
          try {
            received = (await readBinaryBody(req, 8_000_000)).length;
          } catch {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Grande demais.' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ receivedBytes: received }));
          return;
        }
        const sp = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams;
        const total = Math.min(Math.max(Number(sp.get('bytes')) || 2_000_000, 65_536), 8_000_000);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(total),
          'Cache-Control': 'no-store',
        });
        // Random payload so nothing along the way compresses it into a lie.
        const chunk = crypto.randomBytes(64 * 1024);
        let sent = 0;
        const write = () => {
          while (sent < total) {
            const remaining = total - sent;
            const buf = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
            sent += buf.length;
            if (!res.write(buf)) {
              res.once('drain', write);
              return;
            }
          }
          res.end();
        };
        write();
        return;
      }

      // ── Library blob store: upload once, stream from any device ──────────
      if (req.method === 'POST' && pathname === '/blob') {
        // Toda recusa passa por rejectUpload: responder sem drenar o corpo que
        // ainda sobe vira ERR_HTTP2_PROTOCOL_ERROR no navegador em vez do
        // status real (ver drainBody).
        if (!(await authorize(req))) {
          await rejectUpload(req, res, 403, { error: 'Acesso negado.' });
          return;
        }
        // USB fora do ar → recusa em vez de gravar no disco raiz por engano.
        if (!(await blobStoreReady())) {
          await rejectUpload(req, res, 503, { error: 'Armazenamento de blobs indisponível.' });
          return;
        }
        const id = req.headers['x-blob-id'];
        if (!safeBlobId(id)) {
          await rejectUpload(req, res, 400, { error: 'id inválido.' });
          return;
        }
        let buf;
        try {
          buf = await readBinaryBody(req, MAX_BLOB);
        } catch {
          // readBinaryBody já destruiu a requisição ao estourar o limite; aqui
          // só resta responder — não há mais corpo para drenar.
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
        void sweepBlobStore(); // mantém o cofre dentro do teto (LRU)
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

      // ── Transcrição com tempo por palavra (letra sincronizada) ─────────────
      // Recebe o áudio que o navegador JÁ tem no aparelho e devolve só as
      // palavras com seus instantes. O texto exibido continua vindo do LRCLIB;
      // daqui sai apenas o relógio.
      if (req.method === 'POST' && pathname === '/ai/transcribe') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        if (!transcribeConfigured()) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Transcrição não configurada no servidor.' }));
          return;
        }
        try {
          const audio = await readBodyBuffer(req, MAX_TRANSCRIBE_BYTES);
          if (!audio || audio.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Áudio obrigatório.' }));
            return;
          }
          const language =
            new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams.get('language') ||
            undefined;
          const wav = await toWav16k(audio, FFMPEG_BIN);
          const words = await transcribeWords(wav, { language });
          // Sem tempo útil, sincronizar produziria um karaokê que não anda —
          // melhor dizer que não deu e deixar a letra plana em paz.
          if (words.length === 0 || timestampsAreDegenerate(words)) {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Sem tempos utilizáveis para esta faixa.' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ words }));
        } catch (err) {
          log('transcribe error:', err instanceof Error ? err.message : err);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Falha ao transcrever.' }));
        }
        return;
      }

      // ── Embeddings (recomendação semântica) ────────────────────────────────
      // Vetoriza textos de faixas para medir SEMELHANÇA real entre músicas —
      // o que o rótulo de gênero não captura. Mesmo proxy do /ai/chat: a chave
      // nunca chega ao navegador.
      if (req.method === 'POST' && pathname === '/ai/embed') {
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
          const input = Array.isArray(body.input) ? body.input.filter((t) => typeof t === 'string') : [];
          if (input.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'input obrigatório.' }));
            return;
          }
          if (input.length > EMBED_MAX_BATCH) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Máximo ${EMBED_MAX_BATCH} textos por chamada.` }));
            return;
          }
          // input_type é semanticamente obrigatório nestes modelos: indexar
          // ('passage') e consultar ('query') produzem vetores diferentes, e
          // misturar os dois degrada a busca silenciosamente.
          const inputType = body.input_type === 'query' ? 'query' : 'passage';
          const upstream = await fetch(`${NVIDIA_BASE}/embeddings`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${NVIDIA_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: typeof body.model === 'string' ? body.model : NVIDIA_EMBED_MODEL,
              input,
              input_type: inputType,
              encoding_format: 'float',
              truncate: 'END', // título+artista jamais estoura contexto; guarda barata
            }),
          });
          const data = await upstream.json().catch(() => ({}));
          if (!upstream.ok) {
            log('embed error:', upstream.status, JSON.stringify(data).slice(0, 300));
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Falha ao gerar embeddings.' }));
            return;
          }
          // Resposta no formato OpenAI: data[].embedding, com index próprio.
          // Reordenamos por `index` porque a ordem do array não é garantida.
          const rows = Array.isArray(data?.data) ? [...data.data] : [];
          rows.sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
          const embeddings = rows.map((r) => (Array.isArray(r?.embedding) ? r.embedding : null));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ embeddings }));
        } catch (err) {
          log('embed error:', err instanceof Error ? err.message : err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Falha ao gerar embeddings.' }));
        }
        return;
      }

      // ── Import por JOB: POST /import/start → GET /import/job/:id → GET /import/file/:id ──
      if (req.method === 'POST' && pathname === '/import/start') {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado. Entre na sua conta para importar.' }));
          return;
        }
        try {
          const { url, quality } = JSON.parse((await readBody(req)) || '{}');
          if (typeof url !== 'string' || !hostSupported(url)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Link não suportado.' }));
            return;
          }
          const id = startImportJob(url, quality);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Pedido inválido.' }));
        }
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/import/job/')) {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const job = importJobs.get(pathname.slice('/import/job/'.length));
        if (!job) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Download não encontrado (expirou?).' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: job.status,
            error: job.error,
            permanent: job.permanent,
            meta: job.meta,
          }),
        );
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/import/file/')) {
        if (!(await authorize(req))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Acesso negado.' }));
          return;
        }
        const id = pathname.slice('/import/file/'.length);
        const job = importJobs.get(id);
        if (!job || job.status !== 'done' || !job.file) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Arquivo não está pronto (ou o download expirou).' }));
          return;
        }
        try {
          const { size } = await stat(job.file);
          res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(size) });
          const { createReadStream } = await import('node:fs');
          await new Promise((resolve, reject) => {
            const rs = createReadStream(job.file);
            rs.on('error', reject);
            res.on('finish', resolve);
            rs.pipe(res);
          });
          dropImportJob(id); // entregue — libera o /tmp na hora
        } catch {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Falha ao ler o arquivo.' }));
          } else {
            res.destroy();
          }
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
            // 422 = defeito permanente DA FAIXA (sem retry); 500 = transiente.
            res.writeHead(isPermanentImportError(message) ? 422 : 500, {
              'Content-Type': 'application/json',
            });
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
