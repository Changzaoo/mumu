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
  /** Artist name, if available. */
  artist?: string;
  /** Album title, if available. */
  album?: string;
  /** Cover art URL (e.g. YouTube thumbnail), if available from info json. */
  coverUrl?: string;
  /** Genre, if available from tags. */
  genre?: string;
  /** Original video URL that was downloaded. */
  url: string;
  /** Path to the Whisper-generated word timestamps JSON file, if generated. */
  lyricSyncFilePath?: string;
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

/** Read metadata from `<base>.info.json` for title, artist, cover, etc. */
async function readInfoMetadata(
  destDir: string,
  baseName: string,
): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  coverUrl?: string;
}> {
  try {
    const raw = await readFile(path.join(destDir, `${baseName}.info.json`), 'utf8');
    const info = JSON.parse(raw) as Record<string, unknown>;
    // yt-dlp may store thumbnails as an array; pick the last (highest quality)
    const thumbnails = Array.isArray(info.thumbnails)
      ? (info.thumbnails as Array<Record<string, unknown>>)
      : info.thumbnail
        ? [{ url: info.thumbnail }]
        : [];
    const lastThumb = thumbnails.at(-1);
    const coverUrl =
      typeof lastThumb?.url === 'string' && lastThumb?.url.length > 0 ? lastThumb.url : undefined;

    return {
      title: typeof info.title === 'string' && info.title.trim() ? info.title.trim() : undefined,
      artist:
        (typeof info.artist === 'string' && info.artist.trim()) ||
        (typeof info.uploader === 'string' && info.uploader.trim()) ||
        undefined,
      album: typeof info.album === 'string' && info.album.trim() ? info.album.trim() : undefined,
      genre: typeof info.genre === 'string' && info.genre.trim() ? info.genre.trim() : undefined,
      coverUrl,
    };
  } catch {
    return {};
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

import { access, constants } from 'node:fs/promises';

/**
 * Run Whisper on audio file to generate word-level timestamps.
 * Returns path to JSON output file on success, null on failure.
 */
async function runWhisperOnAudio(filePath: string): Promise<string | null> {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));

  try {
    // Try whisper.cpp first (if installed)
    const whisperResult = await runWhisperCommand(filePath, dir, baseName, 'whisper');
    if (whisperResult) return whisperResult;

    // Fallback to Python whisper module
    return await runWhisperCommand(filePath, dir, baseName, 'python', '-m', 'whisper');
  } catch (err) {
    logger.warn(
      { filePath, error: err instanceof Error ? err.message : String(err) },
      'Whisper processing failed; lyric synchronization will be skipped',
    );
    return null;
  }
}

/**
 * Helper to run a Whisper command and return output path on success.
 */
async function runWhisperCommand(
  filePath: string,
  dir: string,
  baseName: string,
  command: string,
  ...args: string[]
): Promise<string | null> {
  return new Promise<string>((resolve, reject) => {
    // Build arguments depending on the command
    let whisperArgs: string[];
    if (command === 'whisper') {
      // whisper.cpp binary
      whisperArgs = [
        filePath,
        '--model',
        'tiny',
        '--language',
        'pt',
        '--output-format',
        'json',
        '--output-dir',
        dir,
        ...args,
      ];
    } else {
      // python -m whisper
      whisperArgs = [
        '-m',
        'whisper',
        filePath,
        '--model',
        'tiny',
        '--language',
        'pt',
        '--output_format',
        'json',
        '--output_dir',
        dir,
        ...args,
      ];
    }

    const child = spawn(command, whisperArgs, { windowsHide: true });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });

    child.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`Whisper command failed with code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      // Whisper outputs <basename>.json in output_dir with --output_format json
      const outputPath = path.join(dir, `${baseName}.json`);
      // Verify file was created
      try {
        await access(outputPath, constants.F_OK);
        resolve(outputPath);
      } catch {
        // Try alternative output path (some versions write to filePath.json)
        const altPath = `${filePath}.json`;
        try {
          await access(altPath, constants.F_OK);
          resolve(altPath);
        } catch {
          reject(new Error('Whisper output file not found'));
        }
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
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
    '--x',
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
          logger.warn({ url, code, stderr: stderr.slice(-500) }, 'yt-dlp exited non-zero');
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
        // Read metadata from info.json for better title/artist/cover
        const metadata = await readInfoMetadata(destDir, baseName);
        const title = metadata.title ?? path.parse(filePath).name;
        const artist = metadata.artist ?? undefined;
        const album = metadata.album ?? undefined;
        const coverUrl = metadata.coverUrl ?? undefined;
        const genre = metadata.genre ?? undefined;

        // Run Whisper for lyric synchronization (optional)
        let lyricSyncFilePath: string | undefined;
        try {
          const whisperResult = await runWhisperOnAudio(filePath);
          if (whisperResult) {
            lyricSyncFilePath = whisperResult;
          }
        } catch (err) {
          logger.warn(
            { filePath, error: err instanceof Error ? err.message : String(err) },
            'Whisper processing failed; continuing without lyric sync',
          );
        }

        resolve({
          filePath,
          title,
          artist,
          album,
          coverUrl,
          genre,
          url, // Save the original URL for potential re-download
          lyricSyncFilePath,
        });
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
