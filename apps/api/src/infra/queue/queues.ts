import { Queue } from 'bullmq';
import type { ImportProvider, UploadMetadataInput } from '@aurial/shared';
import { createBullConnection } from '../redis/redis.js';

export const QUEUE_NAMES = {
  audioProcess: 'audio-process',
  importSync: 'import-sync',
  notifications: 'notifications',
} as const;

export interface AudioProcessJobData {
  uploadId: string;
  userId: string;
  rawKey: string;
  fileName: string;
  overrides?: UploadMetadataInput;
}

export interface ImportSyncJobData {
  importJobId: string;
  userId: string;
  provider: ImportProvider;
  /** Short-lived OAuth token for the user's own cloud storage — never persisted. */
  accessToken: string;
  folderPath?: string;
}

export interface NotificationJobData {
  userId: string;
  type: string;
  title: string;
  body?: string;
  linkUrl?: string;
}

interface QueueSet {
  audioProcess: Queue<AudioProcessJobData>;
  importSync: Queue<ImportSyncJobData>;
  notifications: Queue<NotificationJobData>;
}

let queues: QueueSet | null = null;

/** Lazily created so unit tests can import this module without Redis. */
export function getQueues(): QueueSet {
  if (!queues) {
    const connection = createBullConnection();
    const defaultJobOptions = {
      removeOnComplete: { age: 24 * 3600, count: 500 },
      removeOnFail: { age: 7 * 24 * 3600 },
    };
    queues = {
      audioProcess: new Queue(QUEUE_NAMES.audioProcess, {
        connection,
        defaultJobOptions: {
          ...defaultJobOptions,
          attempts: 2,
          backoff: { type: 'exponential', delay: 10_000 },
        },
      }),
      importSync: new Queue(QUEUE_NAMES.importSync, { connection, defaultJobOptions }),
      notifications: new Queue(QUEUE_NAMES.notifications, {
        connection,
        defaultJobOptions: {
          ...defaultJobOptions,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      }),
    };
  }
  return queues;
}

export async function enqueueAudioProcess(data: AudioProcessJobData): Promise<void> {
  await getQueues().audioProcess.add('process', data, { jobId: data.uploadId });
}

export async function enqueueImportSync(data: ImportSyncJobData): Promise<void> {
  await getQueues().importSync.add('sync', data, { jobId: data.importJobId });
}

export async function enqueueNotification(data: NotificationJobData): Promise<void> {
  await getQueues().notifications.add('notify', data);
}

export async function closeQueues(): Promise<void> {
  if (!queues) return;
  await Promise.allSettled([
    queues.audioProcess.close(),
    queues.importSync.close(),
    queues.notifications.close(),
  ]);
  queues = null;
}

/** Redis pub/sub channel bridging workers → API socket.io process. */
export const REALTIME_NOTIFY_CHANNEL = 'realtime:notify';
