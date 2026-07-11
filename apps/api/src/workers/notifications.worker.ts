import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { redis } from '../infra/redis/redis.js';
import {
  QUEUE_NAMES,
  REALTIME_NOTIFY_CHANNEL,
  type NotificationJobData,
} from '../infra/queue/queues.js';

const log = logger.child({ worker: 'notifications' });

async function processNotification(job: Job<NotificationJobData>): Promise<void> {
  const { userId, type, title, body, linkUrl } = job.data;

  const notification = await prisma.notification.create({
    data: { userId, type, title, body: body ?? null, linkUrl: linkUrl ?? null },
  });

  // Bridge to the API process — realtime/socket.ts forwards to room user:<id>.
  await redis
    .publish(
      REALTIME_NOTIFY_CHANNEL,
      JSON.stringify({
        userId,
        notification: {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          linkUrl: notification.linkUrl,
          createdAt: notification.createdAt.toISOString(),
        },
      }),
    )
    .catch((err) => log.warn({ err }, 'realtime publish failed'));

  log.debug({ userId, type }, 'notification delivered');
}

export function createNotificationsWorker(connection: Redis): Worker<NotificationJobData> {
  return new Worker<NotificationJobData>(QUEUE_NAMES.notifications, processNotification, {
    connection,
    concurrency: 10,
  });
}
