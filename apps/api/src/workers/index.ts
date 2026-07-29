import type { Worker } from 'bullmq';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { redis, createBullConnection } from '../infra/redis/redis.js';
import { env } from '../config/index.js';
import { closeQueues } from '../infra/queue/queues.js';
import { createAudioProcessWorker } from './audioProcess.worker.js';
import { createImportSyncWorker } from './importSync.worker.js';
import { createLinkImportWorker } from './linkImport.worker.js';
import { createLyricSyncWorker } from './lyricSync.worker.js';
import { createNotificationsWorker } from './notifications.worker.js';
import { startCurationWorker } from './curation.worker.js';

const connection = createBullConnection();

const workers: Worker[] = [
  createAudioProcessWorker(connection),
  createImportSyncWorker(connection),
  createNotificationsWorker(connection),
  // Only spin up the link-import consumer where the operator enabled it.
  ...(env.LINK_IMPORT_ENABLED ? [createLinkImportWorker(connection)] : []),
  // Same for transcription: it needs Whisper installed on this host.
  ...(env.WHISPER_ENABLED ? [createLyricSyncWorker(connection)] : []),
];

for (const worker of workers) {
  worker.on('failed', (job, err) => {
    logger.error({ queue: worker.name, jobId: job?.id, err }, 'job failed');
  });
  worker.on('error', (err) => {
    logger.error({ queue: worker.name, err }, 'worker error');
  });
}

// A curadoria não é uma fila BullMQ: é um laço próprio sobre o Firestore, que
// não depende de ninguém enfileirar nada — é o que a torna 24/7.
const stopCuration = env.CURATION_ENABLED ? startCurationWorker() : () => undefined;

logger.info(
  { queues: workers.map((w) => w.name), curadoria: env.CURATION_ENABLED },
  'Aurial workers started',
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'workers shutting down');

  const forceExit = setTimeout(() => process.exit(1), 30_000);
  forceExit.unref();

  stopCuration();

  // close() waits for in-flight jobs (important: never kill a transcode midway)
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues().catch(() => undefined);
  await connection.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection (worker)'));
