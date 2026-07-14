/**
 * Self-hosted link importer — thin wrapper around the `yt-dlp` binary.
 *
 * ⚠️  Intended for SINGLE-OPERATOR, self-hosted use with content you are
 * authorized to download (your own uploads, Creative Commons, public domain).
 * Gated behind `LINK_IMPORT_ENABLED`; never enabled on the public deployment.
 * Downloading copyrighted material without permission may violate the source
 * platform's Terms of Service and copyright law — that responsibility is the
 * operator's.
 *
 * We shell out with an argv array (never a shell string), so the validated URL
 * cannot inject flags/commands. yt-dlp uses the system ffmpeg (FFMPEG_PATH) to
 * extract audio to MP3, embedding the thumbnail + metadata so the downstream
 * audio pipeline picks up cover art / title / artist automatically.
 */
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  LINK_IMPORT_HOSTS,
  LINK_IMPORT_MAX_DURATION_SECONDS,
  MAX_UPLOAD_SIZE_BYTES,
} from '@aurial/shared';
import { env } from '../../config/index.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ infra: 'yt-dlp' });

const ytdlpBin = (): string => env.YTDLP_PATH || 'yt-dlp';

/** True when the URL host is one the importer is allowed to resolve. */
export function isSupportedLinkHost(rawUrl: string): boolean {
  let host: string;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  return LINK_IMPORT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export interface DownloadedAudio {
  /** Absolute path to the extracted MP3 on local disk. */
  filePath: string;
  /** Best-effort human title (from yt-dlp info); falls back to the file base. */
  title: string;
}

export interface DownloadOptions {
  url: string;
  destDir: string;
  /** Deterministic base name (we use the upload id) so the output is findable. */
  baseName: string;
  /** 0..100 download progress. */
  onProgress?: (percent: number) => void;
}

const PROGRESS_RE = /\[download\]\s+([\d.]+)%/;

/** Read `<base>.info.json` written by --write-info-json, if present. */
async function readInfoTitle(destDir: string, baseName: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(destDir, `${baseName}.info.json`), 'utf8');
    const info = JSON.parse(raw) as { title?: unknown };
    return typeof info.title === 'string' && info.title.trim() ? info.title.trim() : null;
  } catch {
    return null;
  }
}

/** Locate the extracted MP3 (yt-dlp names it `<base>.mp3`). */
async function findOutputMp3(destDir: string, baseName: string): Promise<string | null> {
  const expected = path.join(destDir, `${baseName}.mp3`);
  try {
    const entries = await readdir(destDir);
    const match =
      entries.find((f) => f === `${baseName}.mp3`) ?? entries.find((f) => f.endsWith('.mp3'));
    return match ? path.join(destDir, match) : null;
  } catch {
    return expected;
  }
}

/**
 * Download the best audio for `url` and extract it to MP3 in `destDir`.
 * Rejects with a friendly (pt-BR) message on any failure.
 */
export function downloadAudio(opts: DownloadOptions): Promise<DownloadedAudio> {
  const { url, destDir, baseName, onProgress } = opts;

  const args = [
    '--no-playlist',
    '--no-progress', // we parse our own --newline lines below
    '--newline',
    '--no-warnings',
    '-f',
    'bestaudio/best',
    '-x',
    '--audio-format',
    'mp3',
    // 320 kbps CBR — Spotify's "Muito alta" tier; avoids a second lossy
    // generation biting into the (already lossy) source codec.
    '--audio-quality',
    '320K',
    '--embed-thumbnail',
    '--embed-metadata',
    '--write-info-json',
    '--match-filter',
    `duration < ${LINK_IMPORT_MAX_DURATION_SECONDS}`,
    '--max-filesize',
    String(MAX_UPLOAD_SIZE_BYTES),
    '--retries',
    '3',
    '-o',
    path.join(destDir, `${baseName}.%(ext)s`),
  ];
  if (env.FFMPEG_PATH) args.push('--ffmpeg-location', env.FFMPEG_PATH);
  args.push(url);

  return new Promise<DownloadedAudio>((resolve, reject) => {
    let stderr = '';
    let child;
    try {
      child = spawn(ytdlpBin(), args, { windowsHide: true });
    } catch (err) {
      reject(friendlyError(err));
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const m = PROGRESS_RE.exec(chunk);
      if (m?.[1] && onProgress) onProgress(Math.min(100, Math.round(Number(m[1]))));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });

    child.on('error', (err) => reject(friendlyError(err)));
    child.on('close', (code) => {
      void (async () => {
        if (code !== 0) {
          log.warn({ url, code, stderr: stderr.slice(-500) }, 'yt-dlp exited non-zero');
          reject(new Error(interpretStderr(stderr)));
          return;
        }
        const filePath = await findOutputMp3(destDir, baseName);
        if (!filePath) {
          // Exit 0 with no file usually means the match-filter skipped it.
          reject(
            new Error(
              `O vídeo pode ser muito longo (limite ${Math.round(LINK_IMPORT_MAX_DURATION_SECONDS / 60)} min) ou não ter áudio disponível.`,
            ),
          );
          return;
        }
        const title = (await readInfoTitle(destDir, baseName)) ?? path.parse(filePath).name;
        resolve({ filePath, title });
      })();
    });
  });
}

function friendlyError(err: unknown): Error {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
    return new Error(
      'yt-dlp não encontrado. Instale o yt-dlp e o ffmpeg no servidor (defina YTDLP_PATH se necessário).',
    );
  }
  return new Error(err instanceof Error ? err.message : 'Falha ao iniciar o yt-dlp.');
}

/** Map common yt-dlp stderr into a short, friendly pt-BR message. */
function interpretStderr(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('unsupported url') || s.includes('unable to extract')) {
    return 'Link não suportado ou o conteúdo não pôde ser extraído.';
  }
  if (s.includes('private video') || s.includes('sign in') || s.includes('login')) {
    return 'Esse conteúdo é privado ou exige login.';
  }
  if (s.includes('video unavailable') || s.includes('removed')) {
    return 'Conteúdo indisponível ou removido.';
  }
  if (s.includes('file is larger') || s.includes('max-filesize')) {
    return 'O arquivo passa do limite de tamanho.';
  }
  return 'Não foi possível baixar desse link.';
}
