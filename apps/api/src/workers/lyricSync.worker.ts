/**
 * Lyric sync worker — turns a track's audio into timed lyric lines via Whisper.
 *
 * Runs on its own queue for two reasons: transcription costs minutes of CPU, and
 * it is optional. An upload reaches READY without waiting for it, and a failure
 * here only means the track has no lyrics yet.
 *
 * Machine transcription is never allowed to overwrite better lyrics: if a row
 * already exists from any other source, we leave it alone.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Worker, type Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { QUEUE_NAMES, type LyricSyncJobData } from '../infra/queue/queues.js';
import { getStorage } from '../infra/storage/index.js';
import { transcribeLyrics } from '../infra/whisper/whisper.js';

const log = logger.child({ worker: 'lyric-sync' });

/** Marks rows this worker owns, so a re-run may replace its own output. */
const WHISPER_SOURCE = 'whisper';

async function syncLyrics(job: Job<LyricSyncJobData>): Promise<void> {
  const { trackId, sourceKey } = job.data;

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true, title: true, lyrics: { select: { source: true } } },
  });
  if (!track) {
    log.warn({ trackId }, 'track vanished — skipping lyric sync');
    return;
  }
  // Human/provider lyrics always win over a machine guess.
  if (track.lyrics && track.lyrics.source !== WHISPER_SOURCE) {
    log.info({ trackId, source: track.lyrics.source }, 'lyrics already present — skipping');
    return;
  }

  const tmpDir = path.join(os.tmpdir(), 'aurial-lyrics', trackId);
  await mkdir(tmpDir, { recursive: true });
  const audioPath = path.join(tmpDir, `source${path.extname(sourceKey) || '.mp3'}`);

  try {
    await pipeline(await getStorage().getStream(sourceKey), createWriteStream(audioPath));

    const transcription = await transcribeLyrics(audioPath, tmpDir);
    if (!transcription) return; // already logged with the reason

    await prisma.lyrics.upsert({
      where: { trackId },
      create: {
        trackId,
        synced: true,
        lines: transcription.lines as unknown as Prisma.InputJsonValue,
        source: WHISPER_SOURCE,
      },
      update: {
        synced: true,
        lines: transcription.lines as unknown as Prisma.InputJsonValue,
        source: WHISPER_SOURCE,
      },
    });

    log.info(
      {
        trackId,
        title: track.title,
        lines: transcription.lines.length,
        language: transcription.language,
        model: transcription.model,
      },
      'lyrics transcribed',
    );
  } catch (err) {
    // Swallowed on purpose: a missing transcription is not a broken track.
    log.warn({ err, trackId }, 'lyric sync failed');
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function createLyricSyncWorker(connection: Redis): Worker<LyricSyncJobData> {
  return new Worker<LyricSyncJobData>(QUEUE_NAMES.lyricSync, syncLyrics, {
    connection,
    concurrency: 1, // Whisper is CPU-bound; scale with worker replicas instead
  });
}
