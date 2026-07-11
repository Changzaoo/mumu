import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Worker, type Job } from 'bullmq';
import { customAlphabet } from 'nanoid';
import { parseFile } from 'music-metadata';
import sharp from 'sharp';
import { slugify, WAVEFORM_PEAKS } from '@aurial/shared';
import type { Prisma, UploadStatus } from '@prisma/client';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import type { Redis } from 'ioredis';
import { cache, cacheKeys } from '../infra/redis/cache.js';
import {
  enqueueNotification,
  QUEUE_NAMES,
  type AudioProcessJobData,
} from '../infra/queue/queues.js';
import { setUploadProgress } from '../infra/queue/uploadProgress.js';
import { getStorage } from '../infra/storage/index.js';
import { analyzeLoudness } from '../infra/ffmpeg/loudness.js';
import { extractEmbeddedCover, COVER_SIZES } from '../infra/ffmpeg/cover.js';
import { probeAudio } from '../infra/ffmpeg/probe.js';
import { transcodeHlsLadder } from '../infra/ffmpeg/hls.js';
import { extractWaveformPeaks } from '../infra/ffmpeg/waveform.js';

const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 24);
const log = logger.child({ worker: 'audio-process' });

interface ResolvedMetadata {
  title: string;
  artistName: string;
  albumTitle: string | null;
  genreName: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  picture: Buffer | null;
}

async function setStatus(uploadId: string, status: UploadStatus): Promise<void> {
  await prisma.upload.update({ where: { id: uploadId }, data: { status } });
}

async function resolveMetadata(
  filePath: string,
  fileName: string,
  overrides: AudioProcessJobData['overrides'],
): Promise<ResolvedMetadata> {
  let tags: ResolvedMetadata = {
    title: path.parse(fileName).name,
    artistName: 'Unknown Artist',
    albumTitle: null,
    genreName: null,
    trackNumber: null,
    discNumber: null,
    picture: null,
  };
  try {
    const meta = await parseFile(filePath);
    const pic = meta.common.picture?.[0];
    tags = {
      title: meta.common.title?.trim() || tags.title,
      artistName: meta.common.artist?.trim() || tags.artistName,
      albumTitle: meta.common.album?.trim() || null,
      genreName: meta.common.genre?.[0]?.trim() || null,
      trackNumber: meta.common.track.no ?? null,
      discNumber: meta.common.disk.no ?? null,
      picture: pic ? Buffer.from(pic.data) : null,
    };
  } catch {
    // fall back to filename-derived metadata
  }
  return {
    ...tags,
    title: overrides?.title?.trim() || tags.title,
    artistName: overrides?.artist?.trim() || tags.artistName,
    albumTitle: overrides?.album?.trim() ?? tags.albumTitle,
  };
}

const contentTypeFor = (file: string): string =>
  file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';

/** Uploads every file under dir to storage, preserving relative paths. */
async function uploadDir(localDir: string, keyPrefix: string): Promise<void> {
  const storage = getStorage();
  const entries = await readdir(localDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    const rel = path.relative(localDir, full).split(path.sep).join('/');
    await storage.put(`${keyPrefix}/${rel}`, await readFile(full), contentTypeFor(entry.name));
  }
}

async function processCover(
  picture: Buffer | null,
  sourcePath: string,
  tmpDir: string,
  trackId: string,
): Promise<{ coverUrl: string | null; dominantColor: string | null }> {
  const buffer = picture ?? (await extractEmbeddedCover(sourcePath, tmpDir));
  if (!buffer) return { coverUrl: null, dominantColor: null };
  try {
    const storage = getStorage();
    for (const size of COVER_SIZES) {
      const webp = await sharp(buffer)
        .resize(size, size, { fit: 'cover' })
        .webp({ quality: 82 })
        .toBuffer();
      await storage.put(`covers/${trackId}/${size}.webp`, webp, 'image/webp');
    }
    const { dominant } = await sharp(buffer).stats();
    const hex = `#${[dominant.r, dominant.g, dominant.b]
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')}`;
    return { coverUrl: storage.publicUrl(`covers/${trackId}/300.webp`), dominantColor: hex };
  } catch (err) {
    log.warn({ err, trackId }, 'cover processing failed — continuing without art');
    return { coverUrl: null, dominantColor: null };
  }
}

async function upsertCatalog(
  meta: ResolvedMetadata,
  cover: { coverUrl: string | null; dominantColor: string | null },
): Promise<{ artistId: string; albumId: string | null; genreId: string | null }> {
  const artistSlug = slugify(meta.artistName) || 'unknown-artist';
  const artist = await prisma.artist.upsert({
    where: { slug: artistSlug },
    update: {},
    create: { name: meta.artistName, slug: artistSlug },
  });

  let albumId: string | null = null;
  if (meta.albumTitle) {
    const albumSlug =
      slugify(`${meta.artistName} ${meta.albumTitle}`) || `album-${newId().slice(0, 8)}`;
    const album = await prisma.album.upsert({
      where: { slug: albumSlug },
      update: { ...(cover.coverUrl ? { coverUrl: cover.coverUrl } : {}) },
      create: {
        title: meta.albumTitle,
        slug: albumSlug,
        coverUrl: cover.coverUrl,
        dominantColor: cover.dominantColor,
        artists: { create: { artistId: artist.id } },
      },
    });
    albumId = album.id;
    await cache.del(cacheKeys.album(albumId));
  }

  let genreId: string | null = null;
  if (meta.genreName) {
    const genreSlug = slugify(meta.genreName);
    if (genreSlug) {
      const genre = await prisma.genre.upsert({
        where: { slug: genreSlug },
        update: {},
        create: { name: meta.genreName, slug: genreSlug },
      });
      genreId = genre.id;
    }
  }

  await cache.del(cacheKeys.artist(artist.id));
  return { artistId: artist.id, albumId, genreId };
}

async function processUpload(job: Job<AudioProcessJobData>): Promise<void> {
  const { uploadId, userId, rawKey, fileName, overrides } = job.data;
  const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!upload) {
    log.warn({ uploadId }, 'upload row vanished — skipping job');
    return;
  }

  const tmpDir = path.join(os.tmpdir(), 'aurial-pipeline', uploadId);
  await mkdir(tmpDir, { recursive: true });
  const sourcePath = path.join(tmpDir, `source${path.extname(fileName) || '.bin'}`);

  try {
    // 1) fetch raw bytes from storage to local disk (ffmpeg needs a file)
    await setUploadProgress(uploadId, 2);
    await pipeline(await getStorage().getStream(rawKey), createWriteStream(sourcePath));
    await setUploadProgress(uploadId, 5);

    // 2) probe + tags
    await setStatus(uploadId, 'PROBING');
    const probe = await probeAudio(sourcePath);
    if (probe.durationMs <= 0) throw new Error('Audio has zero duration');
    const meta = await resolveMetadata(sourcePath, fileName, overrides);
    await setUploadProgress(uploadId, 15);

    // 3) loudness + waveform
    await setStatus(uploadId, 'ANALYZING');
    const loudness = await analyzeLoudness(sourcePath);
    await setUploadProgress(uploadId, 30);
    const peaks = await extractWaveformPeaks(sourcePath, WAVEFORM_PEAKS);
    await setUploadProgress(uploadId, 45);

    // 4) HLS ladder → storage
    await setStatus(uploadId, 'TRANSCODING');
    const trackId = newId();
    const hlsDir = path.join(tmpDir, 'hls');
    await transcodeHlsLadder(sourcePath, hlsDir, (pct) => {
      void setUploadProgress(uploadId, 45 + Math.round(pct * 0.35)); // 45..80
    });
    await uploadDir(hlsDir, `audio/${trackId}`);
    await setUploadProgress(uploadId, 85);

    // 5) cover art
    const cover = await processCover(meta.picture, sourcePath, tmpDir, trackId);
    await setUploadProgress(uploadId, 92);

    // 6) catalog rows
    const { artistId, albumId, genreId } = await upsertCatalog(meta, cover);
    await prisma.track.create({
      data: {
        id: trackId,
        title: meta.title,
        durationMs: probe.durationMs,
        trackNumber: meta.trackNumber,
        discNumber: meta.discNumber,
        coverUrl: cover.coverUrl,
        dominantColor: cover.dominantColor,
        loudnessLufs: loudness.inputI,
        truePeakDb: loudness.inputTp,
        waveform: peaks as Prisma.InputJsonValue,
        hlsKey: `audio/${trackId}/master.m3u8`,
        originalKey: rawKey,
        sourceCodec: probe.codec,
        sampleRate: probe.sampleRate,
        uploadedByUserId: userId,
        albumId,
        artists: { create: { artistId } },
        ...(genreId ? { genres: { create: { genreId } } } : {}),
      },
    });

    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: 'READY', trackId, error: null },
    });
    await setUploadProgress(uploadId, 100);

    // 7) side effects — worker runs out-of-process, so write the feed row
    // directly and notify through the notifications queue → socket bridge.
    await prisma.feedEvent
      .create({
        data: { actorId: userId, type: 'UPLOADED_TRACK', trackId, targetTitle: meta.title },
      })
      .catch(() => undefined);
    await enqueueNotification({
      userId,
      type: 'upload.ready',
      title: 'Your upload is ready',
      body: `"${meta.title}" was processed and is ready to play.`,
      linkUrl: `/track/${trackId}`,
    }).catch(() => undefined);

    log.info({ uploadId, trackId, title: meta.title }, 'upload processed');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown processing error';
    log.error({ err, uploadId }, 'audio pipeline failed');
    await prisma.upload
      .update({ where: { id: uploadId }, data: { status: 'FAILED', error: message } })
      .catch(() => undefined);
    await enqueueNotification({
      userId,
      type: 'upload.failed',
      title: 'Upload processing failed',
      body: `"${fileName}": ${message}`,
    }).catch(() => undefined);
    throw err; // let BullMQ record the failure
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function createAudioProcessWorker(connection: Redis): Worker<AudioProcessJobData> {
  return new Worker<AudioProcessJobData>(QUEUE_NAMES.audioProcess, processUpload, {
    connection,
    concurrency: 1, // ffmpeg is CPU-bound; scale via worker replicas instead
  });
}
