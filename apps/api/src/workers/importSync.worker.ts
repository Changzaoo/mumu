import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { ImportProvider } from '@aurial/shared';
import type { ImportStatus } from '@prisma/client';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { QUEUE_NAMES, type ImportSyncJobData } from '../infra/queue/queues.js';

const log = logger.child({ worker: 'import-sync' });

interface CloudAudioFile {
  /** Provider-scoped file id/path used for the download call. */
  ref: string;
  name: string;
  sizeBytes: number;
}

/**
 * One adapter per provider. Each returns the audio files under folderPath
 * and can stream a single file. Implementations are TODO — the surrounding
 * job lifecycle (scan → import → progress → done/failed) is fully wired.
 */
interface CloudProviderAdapter {
  listAudioFiles(accessToken: string, folderPath?: string): Promise<CloudAudioFile[]>;
  // download(accessToken: string, file: CloudAudioFile): Promise<Readable>;
}

const notImplemented = (provider: ImportProvider): CloudProviderAdapter => ({
  listAudioFiles() {
    // TODO(imports): call the provider SDK —
    //  - google-drive: googleapis drive.files.list({ q: "mimeType contains 'audio/'" })
    //  - dropbox: Dropbox SDK filesListFolder({ path: folderPath ?? '' })
    //  - onedrive: Microsoft Graph /me/drive/root:/{folderPath}:/children
    // Filter by ACCEPTED_AUDIO_EXT, map to CloudAudioFile.
    throw new Error(`${provider} import is not configured yet`);
  },
});

const adapters: Record<ImportProvider, CloudProviderAdapter> = {
  'google-drive': notImplemented('google-drive'),
  dropbox: notImplemented('dropbox'),
  onedrive: notImplemented('onedrive'),
};

async function setStatus(
  importJobId: string,
  status: ImportStatus,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await prisma.importJob.update({ where: { id: importJobId }, data: { status, ...patch } });
}

async function processImport(job: Job<ImportSyncJobData>): Promise<void> {
  const { importJobId, provider, accessToken, folderPath } = job.data;
  const row = await prisma.importJob.findUnique({ where: { id: importJobId } });
  if (!row) {
    log.warn({ importJobId }, 'import job row vanished — skipping');
    return;
  }

  try {
    await setStatus(importJobId, 'SCANNING');
    const files = await adapters[provider].listAudioFiles(accessToken, folderPath);
    await setStatus(importJobId, 'IMPORTING', { totalFiles: files.length });

    let imported = 0;
    for (const file of files) {
      // TODO(imports): download the file via the adapter, then reuse the
      // upload path end-to-end: storage.put(uploads/raw/<id>) → create
      // Upload row → enqueueAudioProcess({...}) — identical to POST /uploads.
      log.info({ importJobId, file: file.name }, 'importing file (stub)');
      imported += 1;
      await prisma.importJob.update({
        where: { id: importJobId },
        data: { importedFiles: imported },
      });
    }

    await setStatus(importJobId, 'DONE');
    log.info({ importJobId, imported }, 'import finished');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown import error';
    await setStatus(importJobId, 'FAILED', { error: message }).catch(() => undefined);
    log.error({ err, importJobId }, 'import failed');
    throw err;
  }
}

export function createImportSyncWorker(connection: Redis): Worker<ImportSyncJobData> {
  return new Worker<ImportSyncJobData>(QUEUE_NAMES.importSync, processImport, {
    connection,
    concurrency: 2,
  });
}
