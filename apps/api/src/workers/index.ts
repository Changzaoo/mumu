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
import { startArmazenamentoWorker } from './armazenamento.worker.js';
import { startAcervoFielWorker } from './acervoFiel.worker.js';
import { startVarreduraNoturnaWorker } from './varreduraNoturna.worker.js';

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

// O agente de armazenamento roda SEMPRE, independente de curadoria e de IA:
// ele não depende de chave nenhuma, e disco cheio derruba tudo o mais. As duas
// vezes em que este servidor encheu, o sintoma não pareceu disco.
const stopArmazenamento = startArmazenamentoWorker();

// O acervo não pode anunciar cópia que não existe: uma poda antiga do cofre
// levou a meta junto com os bytes e deixou faixas que respondem 404 para
// sempre. Este agente varre devagar e para de anunciar as que sumiram — sem
// jogar fora o `sourceUrl`, que é o caminho de volta. Ver acervoFiel.worker.
const stopAcervoFiel = startAcervoFielWorker();

// A varredura de madrugada é a outra metade do acervo fiel: aquele ESCONDE o
// que não toca, esta TRAZ DE VOLTA o que ainda tem caminho de origem. Só sobe
// quando o importador e o crachá de máquina estão configurados, e só trabalha
// com folga no cofre — ver varreduraNoturna.worker.
const stopVarredura = startVarreduraNoturnaWorker();

logger.info(
  {
    queues: workers.map((w) => w.name),
    curadoria: env.CURATION_ENABLED,
    armazenamento: true,
    acervoFiel: true,
  },
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
  stopArmazenamento();
  stopAcervoFiel();
  stopVarredura();

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
