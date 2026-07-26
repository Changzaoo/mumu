/**
 * Automatic lyric transcription — thin wrapper around the OpenAI Whisper CLI.
 *
 * Whisper gives us *timed* speech, which is exactly what a karaoke view needs.
 * We ask for word-level timestamps (`--word_timestamps True`) and then fold the
 * words back into display lines, so a 20-second segment becomes several short
 * lines that land on the right beat instead of one wall of text.
 *
 * Gated behind `WHISPER_ENABLED`. Transcription is best-effort by design: every
 * failure path returns `null` and the caller simply leaves the track without
 * lyrics. It must never be on the critical path of an upload — see
 * `lyricSync.worker.ts`, which runs this on its own queue.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/index.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ infra: 'whisper' });

/** A single display line, matching `Lyrics.lines` in the schema. */
export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface Transcription {
  lines: LyricLine[];
  /** Language Whisper detected (or the one we forced). */
  language: string | null;
  model: string;
}

/**
 * Display tuning. Whisper segments run long; these caps keep a karaoke line
 * readable at a glance and are only applied when word timestamps exist.
 */
const MAX_LINE_CHARS = 42;
const MAX_LINE_MS = 7_000;

export function isWhisperEnabled(): boolean {
  return env.WHISPER_ENABLED;
}

/** Shape of the JSON the Whisper CLI writes with `--output_format json`. */
interface WhisperWord {
  word?: unknown;
  start?: unknown;
  end?: unknown;
}
interface WhisperSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  words?: unknown;
}
interface WhisperJson {
  language?: unknown;
  segments?: unknown;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const toMs = (seconds: number): number => Math.max(0, Math.round(seconds * 1000));

/**
 * Fold one segment into one or more display lines.
 *
 * Without word timestamps we can only emit the segment as-is. With them, we
 * greedily pack words until the line gets too long or too slow to follow, which
 * is what makes the result usable as karaoke rather than as a transcript.
 */
function segmentToLines(segment: WhisperSegment): LyricLine[] {
  const segStart = isFiniteNumber(segment.start) ? segment.start : null;
  const segText = typeof segment.text === 'string' ? segment.text.trim() : '';

  const words: { text: string; start: number; end: number }[] = Array.isArray(segment.words)
    ? (segment.words as WhisperWord[])
        .map((w) => ({
          text: typeof w.word === 'string' ? w.word.trim() : '',
          start: isFiniteNumber(w.start) ? w.start : NaN,
          end: isFiniteNumber(w.end) ? w.end : NaN,
        }))
        .filter((w) => w.text.length > 0 && Number.isFinite(w.start))
    : [];

  if (words.length === 0) {
    if (!segText || segStart === null) return [];
    return [{ timeMs: toMs(segStart), text: segText }];
  }

  const lines: LyricLine[] = [];
  let bucket: typeof words = [];

  const flush = (): void => {
    if (bucket.length === 0) return;
    lines.push({
      timeMs: toMs(bucket[0]!.start),
      text: bucket.map((w) => w.text).join(' '),
    });
    bucket = [];
  };

  for (const word of words) {
    const candidateChars = bucket.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;
    const elapsedMs = bucket.length > 0 ? toMs(word.end - bucket[0]!.start) : 0;
    // Never emit an empty line just because a single word blew the budget.
    if (bucket.length > 0 && (candidateChars > MAX_LINE_CHARS || elapsedMs > MAX_LINE_MS)) {
      flush();
    }
    bucket.push(word);
  }
  flush();

  return lines;
}

/** Exported for tests: folds a raw Whisper JSON payload into display lines. */
export function parseWhisperJson(raw: string): { lines: LyricLine[]; language: string | null } {
  const parsed = JSON.parse(raw) as WhisperJson;
  const segments = Array.isArray(parsed.segments) ? (parsed.segments as WhisperSegment[]) : [];

  const lines = segments
    .flatMap(segmentToLines)
    .filter((l) => l.text.length > 0)
    .sort((a, b) => a.timeMs - b.timeMs);

  return {
    lines,
    language: typeof parsed.language === 'string' && parsed.language ? parsed.language : null,
  };
}

/** Read whichever output path this Whisper build chose. */
async function readOutputJson(outDir: string, audioPath: string): Promise<string | null> {
  const base = path.basename(audioPath, path.extname(audioPath));
  const candidates = [
    path.join(outDir, `${base}.json`),
    // Some builds keep the full filename, extension included.
    path.join(outDir, `${path.basename(audioPath)}.json`),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch {
      // try the next shape
    }
  }
  return null;
}

class BinaryMissingError extends Error {}

/**
 * Run one Whisper invocation to completion.
 *
 * Throws `BinaryMissingError` when the runtime itself isn't installed — that is
 * the only case worth retrying with a different runtime.
 */
async function runWhisper(
  command: string,
  leadingArgs: string[],
  audioPath: string,
  outDir: string,
): Promise<string> {
  const args = [
    ...leadingArgs,
    audioPath,
    '--model',
    env.WHISPER_MODEL,
    '--output_format',
    'json',
    '--output_dir',
    outDir,
    // The whole point: per-word timing so we can cut readable lines.
    '--word_timestamps',
    'True',
    // Workers are CPU-only; asking for FP16 there is just a warning per run.
    '--fp16',
    'False',
    ...(env.WHISPER_LANGUAGE ? ['--language', env.WHISPER_LANGUAGE] : []),
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Whisper timed out after ${env.WHISPER_TIMEOUT_MS}ms`));
    }, env.WHISPER_TIMEOUT_MS);
    timer.unref();

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new BinaryMissingError(`${command} not found`));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`whisper exited ${String(code)}: ${stderr.slice(-500)}`));
        return;
      }
      resolve(stderr);
    });
  });
}

/**
 * Transcribe `audioPath` into timed lyric lines, writing scratch output to
 * `outDir`. Returns `null` when Whisper is unavailable, fails, or hears nothing.
 */
export async function transcribeLyrics(
  audioPath: string,
  outDir: string,
): Promise<Transcription | null> {
  if (!env.WHISPER_ENABLED) return null;

  // The CLI first, then the module form — a pip install without a console
  // script on PATH is common enough to be worth the second attempt. Each
  // attempt is isolated, so a missing binary genuinely falls through.
  const attempts: { command: string; leadingArgs: string[] }[] = [
    { command: env.WHISPER_PATH || 'whisper', leadingArgs: [] },
    { command: 'python3', leadingArgs: ['-m', 'whisper'] },
    { command: 'python', leadingArgs: ['-m', 'whisper'] },
  ];

  for (const [index, attempt] of attempts.entries()) {
    try {
      await runWhisper(attempt.command, attempt.leadingArgs, audioPath, outDir);
    } catch (err) {
      if (err instanceof BinaryMissingError && index < attempts.length - 1) {
        continue; // try the next runtime
      }
      log.warn(
        { audioPath, command: attempt.command, err },
        'whisper transcription failed — track stays without lyrics',
      );
      return null;
    }

    const raw = await readOutputJson(outDir, audioPath);
    if (raw === null) {
      log.warn({ audioPath, outDir }, 'whisper reported success but wrote no JSON');
      return null;
    }
    try {
      const { lines, language } = parseWhisperJson(raw);
      if (lines.length === 0) {
        log.info({ audioPath }, 'whisper found no speech — instrumental?');
        return null;
      }
      return { lines, language, model: env.WHISPER_MODEL };
    } catch (err) {
      log.warn({ audioPath, err }, 'could not parse whisper JSON output');
      return null;
    }
  }

  log.warn({ audioPath }, 'no whisper runtime available (install the `whisper` package)');
  return null;
}
