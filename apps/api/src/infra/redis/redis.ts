import { Redis } from 'ioredis';
import { env } from '../../config/index.js';
import { logger } from '../../core/logger.js';

function attachLogging(client: Redis, name: string): Redis {
  client.on('error', (err) => logger.error({ err, redis: name }, 'redis error'));
  return client;
}

/** Shared client for cache/general commands. Lazy so importing is side-effect free. */
export const redis: Redis = attachLogging(
  new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  }),
  'main',
);

/** BullMQ requires maxRetriesPerRequest: null — one connection per queue/worker set. */
export function createBullConnection(): Redis {
  return attachLogging(new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }), 'bullmq');
}

/** Dedicated subscriber (a subscribing connection cannot run other commands). */
export function createSubscriber(): Redis {
  return attachLogging(new Redis(env.REDIS_URL, { lazyConnect: true }), 'subscriber');
}
