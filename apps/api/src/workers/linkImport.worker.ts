/**
 * Link-import worker — the front half of the self-hosted importer.
 *
 * Downloads audio for a submitted URL via yt-dlp (see infra/ytdlp), validates
 * it, stores the raw bytes at the Upload's reserved key, then enqueues the
 * SAME audio-process job an ordinary upload would — so a link and a dropped
 * file converge on one pipeline (probe → loudness → waveform → HLS → cover →
 * catalog Track). Only runs when LINK_IMPORT_ENABLED gated the enqueue.
 */
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { fileTypeFromFile } from 'file-type';
import type { Redis } from 'ioredis';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import {
  enqueueAudioProcess,
  enqueueNotification,
  QUEUE_NAMES,
  type LinkImportJobData,
} from '../infra/queue/queues.js';
import { setUploadProgress } from '../infra/queue/uploadProgress.js';
import { getStorage } from '../infra/storage/index.js';
import { downloadAudio } from '../infra/ytdlp/ytdlp.js';

const log = logger.child({ worker: 'link-import' });

/** Trim a yt-dlp title down to a safe, sensible upload file name. */
function fileNameFromTitle(title: string): string {
  const clean = title
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[/\\]+/g, '-')
    .trim()
    .slice(0, 180);
  return `${clean || 'faixa'}.mp3`;
}

async function processLinkImport(job: Job<LinkImportJobData>): Promise<void> {
  const { uploadId, userId, rawKey, url } = job.data;
  const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!upload) {
    log.warn({ uploadId }, 'upload row vanished — skipping link import');
    return;
  }

  const tmpDir = path.join(os.tmpdir(), 'aurial-linkimport', uploadId);
  await mkdir(tmpDir, { recursive: true });

  try {
    // 1) download + extract to mp3
    const { filePath, title } = await downloadAudio({
      url,
      destDir: tmpDir,
      baseName: uploadId,
      onProgress: (pct) => void setUploadProgress(uploadId, pct),
    });

    // 2) never trust the source — confirm real audio by magic bytes
    const detected = await fileTypeFromFile(filePath);
    if (!detected || !detected.mime.startsWith('audio/')) {
      throw new Error('O arquivo baixado não é um áudio válido.');
    }
    const { size } = await stat(filePath);

    // 3) store raw bytes at the reserved key + backfill real name/size/mime
    const fileName = fileNameFromTitle(title);
    await getStorage().put(rawKey, createReadStream(filePath), detected.mime);
    await prisma.upload.update({
      where: { id: uploadId },
      data: { fileName, sizeBytes: BigInt(size), mimeType: detected.mime },
    });
    await setUploadProgress(uploadId, 0);

    // 4) hand off to the shared audio pipeline → lands as a catalog Track
    await enqueueAudioProcess({ uploadId, userId, rawKey, fileName });
    log.info({ uploadId, title }, 'link import downloaded — queued for processing');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao importar o link.';
    log.error({ err, uploadId, url }, 'link import failed');
    await prisma.upload
      .update({ where: { id: uploadId }, data: { status: 'FAILED', error: message } })
      .catch(() => undefined);
    await enqueueNotification({
      userId,
      type: 'import.failed',
      title: 'Importação por link falhou',
      body: message,
    }).catch(() => undefined);
    throw err; // let BullMQ record the failure
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function createLinkImportWorker(connection: Redis): Worker<LinkImportJobData> {
  return new Worker<LinkImportJobData>(QUEUE_NAMES.linkImport, processLinkImport, {
    connection,
    // yt-dlp is network+ffmpeg bound; a small amount of parallelism is fine.
    concurrency: 2,
  });
}
